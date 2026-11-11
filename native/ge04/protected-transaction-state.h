#ifndef GE04_PROTECTED_TRANSACTION_STATE_H
#define GE04_PROTECTED_TRANSACTION_STATE_H

/* Diagnostic-only reducer. It cannot authorize dispatch, retry or release.
 * A persisted PRE_SEND_INTENT is ambiguous after process loss: a send may
 * have occurred before the process died.
 */
enum ge04_tx_state {
    GE04_TX_UNOBSERVED = 0,
    GE04_TX_INTENT_RECORDED,
    GE04_TX_SEND_ATTEMPTED,
    GE04_TX_REPLY_OBSERVED,
    GE04_TX_QUARANTINED
};
enum ge04_tx_event {
    GE04_TX_RECORD_INTENT = 1,
    GE04_TX_BEGIN_SEND,
    GE04_TX_OBSERVE_REPLY,
    GE04_TX_PROCESS_LOSS,
    GE04_TX_RESTART_WITH_INTENT,
    GE04_TX_OBSERVATION_CONFLICT
};
enum ge04_tx_state ge04_tx_reduce(enum ge04_tx_state state,
                                  enum ge04_tx_event event);
/* Deliberately no transition in this reducer permits another send. */
int ge04_tx_can_retry(enum ge04_tx_state state);
#endif
