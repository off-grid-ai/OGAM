package ai.offgridmobile.mediashare

import androidx.core.content.FileProvider

/** Its own class, so its manifest entry does not merge with a library's androidx FileProvider. */
class MediaShareFileProvider : FileProvider()
