/**
 * A model load was blocked by the memory budget, but the user CAN choose to load
 * it anyway ("Load Anyway" → retry with { override: true }).
 *
 * This carries an explicit, typed signal rather than relying on message-regex
 * sniffing: the readiness/failure layer checks `isOverridableMemoryError(err)` to
 * decide whether to offer the override button. The message still matches the
 * insufficient-memory reason mapping so existing classification keeps working.
 */
export {
  OverridableModelMemoryError as OverridableMemoryError,
  isOverridableModelMemoryError as isOverridableMemoryError,
  ImageModelIncompleteError,
  isImageModelIncompleteError,
} from '@offgrid/models';
