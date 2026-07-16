/**
 * Back-compat re-export. The typed load errors are PURE (Error subclasses, no I/O) and now live
 * in the pure layer (utils/modelLoadErrors) so pure consumers (e.g. utils/imageModelIntegrity)
 * can import them without a util → service dependency. Existing service/UI importers of
 * '../services/modelLoadErrors' keep working via this re-export.
 */
export {
  OverridableMemoryError,
  isOverridableMemoryError,
  ImageModelIncompleteError,
  isImageModelIncompleteError,
} from '../utils/modelLoadErrors';
