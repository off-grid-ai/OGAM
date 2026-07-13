fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

### bump

```sh
[bundle exec] fastlane bump
```

Bump version across package.json, Android build.gradle, and iOS project

Usage: fastlane bump [type:patch|minor|major]

----


## Android

### android build

```sh
[bundle exec] fastlane android build
```

Build a signed release AAB locally - NO upload. Artifact for testing the pipeline.

### android beta

```sh
[bundle exec] fastlane android beta
```

Build a dev/beta AAB and upload to the Play Store internal track

### android release

```sh
[bundle exec] fastlane android release
```

Build a production AAB and upload to the Play Store production track

### android metadata

```sh
[bundle exec] fastlane android metadata
```

Push Android store listing text + images (no build)

----


## iOS

### ios build

```sh
[bundle exec] fastlane ios build
```

Build a signed release IPA locally - NO upload. Artifact for testing the pipeline.

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Build and upload to TestFlight

### ios release

```sh
[bundle exec] fastlane ios release
```

Build and upload to the App Store

### ios metadata

```sh
[bundle exec] fastlane ios metadata
```

Push App Store listing metadata (no build)

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
