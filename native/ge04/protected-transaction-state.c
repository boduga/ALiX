/* GE-04 diagnostic state reducer; no filesystem, bus or privileged calls. */
#include "protected-transaction-state.h"

enum ge04_tx_state ge04_tx_reduce(enum ge04_tx_state state,
                                  enum ge04_tx_event event) {
    if (state < GE04_TX_UNOBSERVED || state > GE04_TX_QUARANTINED ||
        event < GE04_TX_RECORD_INTENT || event > GE04_TX_OBSERVATION_CONFLICT)
        return GE04_TX_QUARANTINED;
    if (state == GE04_TX_QUARANTINED)
        return GE04_TX_QUARANTINED;
    if (event == GE04_TX_PROCESS_LOSS ||
        event == GE04_TX_RESTART_WITH_INTENT ||
        event == GE04_TX_OBSERVATION_CONFLICT)
        return GE04_TX_QUARANTINED;
    if (state == GE04_TX_UNOBSERVED && event == GE04_TX_RECORD_INTENT)
        return GE04_TX_INTENT_RECORDED;
    if (state == GE04_TX_INTENT_RECORDED && event == GE04_TX_BEGIN_SEND)
        return GE04_TX_SEND_ATTEMPTED;
    if (state == GE04_TX_SEND_ATTEMPTED && event == GE04_TX_OBSERVE_REPLY)
        return GE04_TX_REPLY_OBSERVED;
    /* Duplicate/out-of-order observations are not proof of safety. */
    return GE04_TX_QUARANTINED;
}

int ge04_tx_can_retry(enum ge04_tx_state state) {
    (void)state;
    return 0;
}
