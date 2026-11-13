/* GE-04 non-executing, non-authorizing diagnostic contract. */
#include "nonexecuting-sender-contract.h"
#include <errno.h>
#include <stddef.h>

static int quarantine(struct ge04_sender_contract *c) {
    if (c) c->state = GE04_SC_QUARANTINED;
    errno = EPERM;
    return -1;
}
void ge04_sender_contract_init(struct ge04_sender_contract *c,
                              uint64_t deadline_ns, uint64_t serial) {
    if (!c) return;
    *c = (struct ge04_sender_contract){0};
    if (!deadline_ns || !serial) {
        c->state = GE04_SC_QUARANTINED;
        return;
    }
    c->absolute_deadline_ns = deadline_ns;
    c->serial = serial;
}
int ge04_sender_contract_observe(struct ge04_sender_contract *c,
                                enum ge04_sender_contract_event event,
                                uint64_t now, uint64_t serial,
                                uint64_t job_id) {
    if (!c || c->state == GE04_SC_QUARANTINED)
        return quarantine(c);
    if (!now || now > c->absolute_deadline_ns ||
        now < c->last_observation_ns || serial != c->serial ||
        !c->absolute_deadline_ns || !c->serial)
        return quarantine(c);
    enum ge04_sender_contract_state next;
    switch (event) {
    case GE04_SC_RECORD_INTENT:
        if (c->state != GE04_SC_UNOBSERVED || job_id) return quarantine(c);
        next = GE04_SC_INTENT;
        break;
    case GE04_SC_RECORD_SEND:
        if (c->state != GE04_SC_INTENT || job_id) return quarantine(c);
        next = GE04_SC_SEND_OBSERVED;
        break;
    case GE04_SC_RECORD_REPLY:
        if (c->state != GE04_SC_SEND_OBSERVED || !job_id)
            return quarantine(c);
        c->job_id = job_id;
        next = GE04_SC_REPLY_OBSERVED;
        break;
    case GE04_SC_RECORD_JOB:
        if (c->state != GE04_SC_REPLY_OBSERVED ||
            !job_id || job_id != c->job_id) return quarantine(c);
        next = GE04_SC_JOB_OBSERVED;
        break;
    default:
        return quarantine(c); /* loss, conflict, unknown, duplicate */
    }
    c->state = next;
    c->last_observation_ns = now;
    return 0; /* Observation accepted, NEVER permission. */
}
int ge04_sender_contract_can_send(const struct ge04_sender_contract *c) {
    (void)c;
    return 0;
}
int ge04_sender_contract_can_ack(const struct ge04_sender_contract *c) {
    (void)c;
    return 0;
}
