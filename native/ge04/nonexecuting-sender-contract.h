#ifndef GE04_NONEXECUTING_SENDER_CONTRACT_H
#define GE04_NONEXECUTING_SENDER_CONTRACT_H

#include <stdint.h>

/* GE-04 DESIGN CONTRACT ONLY. No transport, journal, root, ACK or send.
 * Inputs are untrusted caller-supplied diagnostic observations, NOT
 * authenticated D-Bus/kernel provenance. No function returns authority.
 */
enum ge04_sender_contract_state {
    GE04_SC_UNOBSERVED = 0,
    GE04_SC_INTENT,
    GE04_SC_SEND_OBSERVED,
    GE04_SC_REPLY_OBSERVED,
    GE04_SC_JOB_OBSERVED,
    GE04_SC_QUARANTINED
};

enum ge04_sender_contract_event {
    GE04_SC_RECORD_INTENT = 1,
    GE04_SC_RECORD_SEND,
    GE04_SC_RECORD_REPLY,
    GE04_SC_RECORD_JOB,
    GE04_SC_PROCESS_LOSS,
    GE04_SC_CONFLICT
};

struct ge04_sender_contract {
    enum ge04_sender_contract_state state;
    uint64_t absolute_deadline_ns; /* CLOCK_MONOTONIC domain, caller-supplied */
    uint64_t last_observation_ns;
    uint64_t serial; /* caller-supplied; NEVER transport-origin proof */
    uint64_t job_id;
};

void ge04_sender_contract_init(struct ge04_sender_contract *contract,
                              uint64_t deadline_ns, uint64_t serial);
int ge04_sender_contract_observe(struct ge04_sender_contract *contract,
                                enum ge04_sender_contract_event event,
                                uint64_t observation_ns, uint64_t serial,
                                uint64_t job_id);
int ge04_sender_contract_can_send(const struct ge04_sender_contract *contract);
int ge04_sender_contract_can_ack(const struct ge04_sender_contract *contract);
#endif
