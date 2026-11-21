# shellcheck shell=bash
# Sourced by scripts/uat.sh and scripts/promote.sh before they run `bundle exec fastlane`.
#
# Gemfile.lock is bundled with Bundler 4, which needs Ruby 3.2 or newer. macOS ships Ruby 2.6 at
# /usr/bin/ruby, and a shell that does not load Homebrew's PATH (a non-login shell, a script run
# from an editor or an agent) finds that one first, so the beta cut fails inside fastlane.
#
# use_modern_ruby keeps a new enough Ruby already on PATH (rbenv, asdf, ruby/setup-ruby in CI).
# Otherwise it puts Homebrew's Ruby first when it is installed, and stops with how to install it
# when it is not. Set HOMEBREW_RUBY_BIN to use another Ruby bin directory.

ruby_is_modern() {
  command -v ruby >/dev/null 2>&1 &&
    ruby -e 'exit(Gem::Version.new(RUBY_VERSION) >= Gem::Version.new("3.2") ? 0 : 1)' >/dev/null 2>&1
}

use_modern_ruby() {
  ruby_is_modern && return 0
  local bin="${HOMEBREW_RUBY_BIN:-/opt/homebrew/opt/ruby/bin}"
  if [ -x "$bin/ruby" ]; then
    export PATH="$bin:$PATH"
    hash -r
    if ruby_is_modern; then
      echo "Using Homebrew Ruby $(ruby -e 'print RUBY_VERSION') from $bin"
      return 0
    fi
  fi
  local found="none"
  command -v ruby >/dev/null 2>&1 && found="$(ruby -e 'print RUBY_VERSION') at $(command -v ruby)"
  echo "Ruby 3.2 or newer is needed for fastlane (Gemfile.lock uses Bundler 4). Found: $found." >&2
  echo "Install it with: brew install ruby && bundle install" >&2
  echo "Or put a Ruby 3.2+ bin directory first on PATH, or set HOMEBREW_RUBY_BIN to it." >&2
  return 1
}
