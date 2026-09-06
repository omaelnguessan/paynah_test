/** Movements only reach the outbox once they have actually been applied. */
export const OUTBOX_MESSAGE_STATUS = 'Approved';

export const OUTBOX_BATCH_SIZE = 50;
export const OUTBOX_MAX_ATTEMPTS = 10;
