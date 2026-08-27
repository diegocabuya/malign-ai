import { createHash, randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

export type OutboxAttemptEvent =
  | 'CLAIM'
  | 'SEND_STARTED'
  | 'SEND_RETURNED'
  | 'ACK'
  | 'FAIL'
  | 'LEASE_EXPIRED'
  | 'RETRY_SCHEDULED';

export interface ClaimedOutboxMessage {
  readonly id: string;
  readonly gameId: string;
  readonly outboxSequence: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly deduplicationKey: string;
  readonly claimToken: string;
  readonly attemptOrdinal: number;
}

const tokenDigest = (token: string): Buffer => createHash('sha256').update(token).digest();

export class PostgresOutboxPublisher {
  constructor(private readonly pool: Pool) {}

  private async appendAttempt(
    messageId: string,
    attemptOrdinal: number,
    stageOrdinal: number,
    eventType: OutboxAttemptEvent,
    claimToken: string,
    errorCode?: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO malign.outbox_delivery_attempts(
         outbox_message_id,attempt_ordinal,stage_ordinal,event_type,occurred_at,
         claim_token_digest,error_code,correlation_id
       ) VALUES ($1,$2,$3,$4,clock_timestamp(),$5,$6,uuidv7())`,
      [messageId, attemptOrdinal, stageOrdinal, eventType, tokenDigest(claimToken), errorCode ?? null],
    );
  }

  async claimOne(leaseMilliseconds = 30_000, gameId?: string): Promise<ClaimedOutboxMessage | undefined> {
    const client = await this.pool.connect();
    const claimToken = randomUUID();
    try {
      await client.query('BEGIN');
      const candidate = await client.query<{
        id: string;
        game_id: string;
        outbox_sequence: string;
        payload_json: Readonly<Record<string, unknown>>;
        deduplication_key: string;
        last_attempt_ordinal: string;
      }>(
        `SELECT m.id,m.game_id,m.outbox_sequence,m.payload_json,m.deduplication_key,s.last_attempt_ordinal
           FROM malign.outbox_delivery_states s
           JOIN malign.outbox_messages m ON m.id=s.outbox_message_id
          WHERE ((s.delivery_status IN ('PENDING','RETRY_SCHEDULED') AND (s.next_attempt_at IS NULL OR s.next_attempt_at<=clock_timestamp()))
             OR (s.delivery_status='CLAIMED' AND s.claim_expires_at<=clock_timestamp()))
            AND ($1::uuid IS NULL OR m.game_id=$1)
          ORDER BY m.game_id,m.outbox_sequence,m.id
          FOR UPDATE OF s SKIP LOCKED LIMIT 1`,
        [gameId ?? null],
      );
      const row = candidate.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return undefined;
      }
      const attemptOrdinal = Number(row.last_attempt_ordinal) + 1;
      await client.query(
        `UPDATE malign.outbox_delivery_states
            SET delivery_status='CLAIMED',last_attempt_ordinal=$2,claim_token_digest=$3,
                claimed_at=clock_timestamp(),claim_expires_at=clock_timestamp()+($4::text||' milliseconds')::interval,
                last_error_code=NULL
          WHERE outbox_message_id=$1`,
        [row.id, attemptOrdinal, tokenDigest(claimToken), leaseMilliseconds],
      );
      await client.query(
        `INSERT INTO malign.outbox_delivery_attempts(
           outbox_message_id,attempt_ordinal,stage_ordinal,event_type,occurred_at,claim_token_digest,correlation_id
         ) VALUES ($1,$2,1,'CLAIM',clock_timestamp(),$3,uuidv7())`,
        [row.id, attemptOrdinal, tokenDigest(claimToken)],
      );
      await client.query('COMMIT');
      return {
        id: row.id,
        gameId: row.game_id,
        outboxSequence: Number(row.outbox_sequence),
        payload: row.payload_json,
        deduplicationKey: row.deduplication_key,
        claimToken,
        attemptOrdinal,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deliver(
    message: ClaimedOutboxMessage,
    sender: (message: ClaimedOutboxMessage) => Promise<string | undefined>,
  ): Promise<void> {
    await this.appendAttempt(message.id, message.attemptOrdinal, 2, 'SEND_STARTED', message.claimToken);
    try {
      await sender(message);
      await this.appendAttempt(message.id, message.attemptOrdinal, 3, 'SEND_RETURNED', message.claimToken);
    } catch {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO malign.outbox_delivery_attempts(
             outbox_message_id,attempt_ordinal,stage_ordinal,event_type,occurred_at,
             claim_token_digest,error_code,correlation_id
           ) VALUES ($1,$2,3,'FAIL',clock_timestamp(),$3,'TRANSPORT_FAILURE',uuidv7())`,
          [message.id, message.attemptOrdinal, tokenDigest(message.claimToken)],
        );
        await client.query(
          `UPDATE malign.outbox_delivery_states
              SET delivery_status='RETRY_SCHEDULED',next_attempt_at=clock_timestamp(),last_error_code='TRANSPORT_FAILURE'
            WHERE outbox_message_id=$1 AND claim_token_digest=$2`,
          [message.id, tokenDigest(message.claimToken)],
        );
        await client.query(
          `INSERT INTO malign.outbox_delivery_attempts(
             outbox_message_id,attempt_ordinal,stage_ordinal,event_type,occurred_at,claim_token_digest,correlation_id
           ) VALUES ($1,$2,4,'RETRY_SCHEDULED',clock_timestamp(),$3,uuidv7())`,
          [message.id, message.attemptOrdinal, tokenDigest(message.claimToken)],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      throw new Error('Outbox send failed');
    }
  }

  async acknowledge(message: ClaimedOutboxMessage): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE malign.outbox_delivery_states
            SET delivery_status='ACKNOWLEDGED',acknowledged_at=clock_timestamp(),claim_expires_at=NULL,next_attempt_at=NULL
          WHERE outbox_message_id=$1 AND claim_token_digest=$2 AND delivery_status='CLAIMED'`,
        [message.id, tokenDigest(message.claimToken)],
      );
      if (updated.rowCount !== 1) throw new Error('Outbox claim is no longer authoritative');
      await client.query(
        `INSERT INTO malign.outbox_delivery_attempts(
           outbox_message_id,attempt_ordinal,stage_ordinal,event_type,occurred_at,claim_token_digest,correlation_id
         ) VALUES ($1,$2,4,'ACK',clock_timestamp(),$3,uuidv7())`,
        [message.id, message.attemptOrdinal, tokenDigest(message.claimToken)],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recoverExpiredLeases(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const expired = await client.query<{
        outbox_message_id: string;
        last_attempt_ordinal: string;
        claim_token_digest: Buffer | null;
      }>(
        `UPDATE malign.outbox_delivery_states
            SET delivery_status='RETRY_SCHEDULED',next_attempt_at=clock_timestamp(),last_error_code='LEASE_EXPIRED'
          WHERE delivery_status='CLAIMED' AND claim_expires_at<=clock_timestamp()
          RETURNING outbox_message_id,last_attempt_ordinal,claim_token_digest`,
      );
      for (const row of expired.rows) {
        const stage = await client.query<{ next_stage: number }>(
          `SELECT COALESCE(max(stage_ordinal),0)::int+1 next_stage
             FROM malign.outbox_delivery_attempts
            WHERE outbox_message_id=$1 AND attempt_ordinal=$2`,
          [row.outbox_message_id, row.last_attempt_ordinal],
        );
        const nextStage = stage.rows[0]?.next_stage ?? 1;
        await client.query(
          `INSERT INTO malign.outbox_delivery_attempts(
             outbox_message_id,attempt_ordinal,stage_ordinal,event_type,occurred_at,claim_token_digest,correlation_id
           ) VALUES ($1,$2,$3,'LEASE_EXPIRED',clock_timestamp(),$4,uuidv7()),
                    ($1,$2,$5,'RETRY_SCHEDULED',clock_timestamp(),$4,uuidv7())`,
          [row.outbox_message_id, row.last_attempt_ordinal, nextStage, row.claim_token_digest, nextStage + 1],
        );
      }
      await client.query('COMMIT');
      return expired.rowCount ?? 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export class DeduplicatingTestConsumer {
  readonly #seen = new Set<string>();

  consume(message: ClaimedOutboxMessage): boolean {
    if (this.#seen.has(message.deduplicationKey)) return false;
    this.#seen.add(message.deduplicationKey);
    return true;
  }
}
