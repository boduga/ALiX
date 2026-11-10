#ifndef GE04_PROTECTED_PREBIRTH_JOURNAL_H
#define GE04_PROTECTED_PREBIRTH_JOURNAL_H
#include <stddef.h>
#include <stdint.h>

#define GE04_PREBIRTH_UNIT "ge04-r1b2-view-qualification.service"
#define GE04_PREBIRTH_DIR "/var/lib/alix-ge04"
#define GE04_PREBIRTH_FILE "prebirth-intent.v1"
#define GE04_PREBIRTH_MAX 1024

struct ge04_prebirth_claim {
    char boot_id[33];
    uint64_t attempt;
    char nonce[65];
    char source_sha256[65];
    char controller_sha256[65];
};

struct ge04_journal_custody {
    int directory_fd;
    int journal_fd;
    unsigned long long device;
    unsigned long long inode;
    int owned;
};

/* Format only. Canonical bytes are NOT a source of trust. */
int ge04_prebirth_encode(const struct ge04_prebirth_claim *claim,
                         char out[GE04_PREBIRTH_MAX], size_t *length);

/* Root-only, fixed existing private directory, exclusive one-time journal.
 * Production integration is NOT approved; no default binary invokes it.
 * Returns 0 on persistence, -1 on refusal, with errno set.
 * A caller MUST NOT infer authority from success.
 */
int ge04_prebirth_stage(const struct ge04_prebirth_claim *claim,
                        struct ge04_journal_custody *custody);

/* Check held original descriptor/inode and bytes without re-adopting a file. */
int ge04_prebirth_recheck(const struct ge04_prebirth_claim *claim,
                          const struct ge04_journal_custody *custody);

/* Explicitly initialize before staging; closing an unowned struct is a no-op
 * on descriptors. This API never takes ownership of caller-opened FDs.
 */
void ge04_prebirth_custody_init(struct ge04_journal_custody *custody);
/* Close only held original descriptors; no deletion or retry. */
void ge04_prebirth_close(struct ge04_journal_custody *custody);

#endif
