/* GE-04 R1-B1 PROTECTED ROOT CONTROLLER — NOT ACTIVATED.
 *
 * This future trusted controller must not execute from an editable checkout.
 * The actual journal primitive lives in protected-prebirth-journal.c, but
 * this entrypoint does not call it. There is no macro, option, environment
 * setting or argument that enables root action from this binary.
 *
 * Independent source review, frozen staging, disposable VM approval and
 * Q13 are mandatory before implementing an operational entrypoint.
 */
int main(void) {
    return 77; /* GE-04 SECURITY HOLD ACTIVE */
}
