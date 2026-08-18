# Security Specification - Sonic Vault

## Data Invariants
1. A MusicItem must always be owned by the user who created it (`userId`).
2. The `type` of a MusicItem is immutable once created.
3. `createdAt` is immutable.
4. `updatedAt` must be updated to the server time on every update.
5. Ratings must be between 0 and 100.
6. URLs and ImageURLs must be valid URIs and have reasonable size limits.
7. Tags lists are limited to 50 items.

## The "Dirty Dozen" Payloads (Denial Targets)
1. **Identity Spoofing**: Attempt to create an item with `userId` of another user.
2. **Type Overwrite**: Attempt to change the `type` of an existing item (e.g., track -> artist).
3. **Owner Stealing**: Attempt to change the `userId` of an existing item.
4. **Rating Poisoning**: Set `rating` to -1 or 101.
5. **Tag Explosion**: Send a `tags` array with 10,000 elements.
6. **Note Bloating**: Send a `notes` field with 1MB of text.
7. **Temporal Fraud**: Set `createdAt` to a future date instead of `request.time`.
8. **Shadow Field Injection**: Add a `isVerified: true` field to a MusicItem.
9. **ID Poisoning**: Use a document ID that is 1KB of junk characters.
10. **Unauthenticated Write**: Attempt to create an item without being logged in.
11. **Cross-User Read**: Attempt to `get` or `list` items belonging to another `userId`.
12. **Malicious Update**: Update `name` but also sneakily update `userId`.

## Red Team Evaluation Strategy
- Every update must use `affectedKeys().hasOnly()` to block "Shadow Field Injection".
- Every create must check `keys().size()` to enforce strict schema.
- Every read must check `resource.data.userId`.
