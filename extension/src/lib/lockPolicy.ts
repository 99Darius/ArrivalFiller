/**
 * Whether every user must set a passphrase or PIN before saving travellers.
 *
 * false (default): the lock is optional. Users turn it on from the popup.
 * true: the popup asks for one before anything else (existing users on their
 * next open, so their saved data gets encrypted then), it can't be turned off,
 * and the background refuses to save personal data until it is set.
 *
 * A product decision for the maintainer; nothing else needs to change.
 */
export const LOCK_REQUIRED = false;
