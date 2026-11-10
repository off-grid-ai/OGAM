#pragma once
// stable-diffusion.cpp says why a load failed only in its log: new_sd_ctx returns null. The bindings pass
// each log line here, and a failed load names the file it could not read, or else the last error.
#include <cctype>
#include <cstring>
#include <mutex>
#include <regex>
#include <string>

namespace offgrid {

inline const std::regex &allocationFailurePattern() {
  static const std::regex pattern("alloc|out of memory|\\bOOM\\b", std::regex::icase);
  return pattern;
}

class EngineErrorLog {
  std::mutex mutex;
  std::string lastError;
  // Kept apart: sd.cpp can log a vaguer error after the allocation that caused it.
  std::string allocationError;
  std::string unreadableFile;
public:
  /** Lines that mention the prompt are dropped: they can carry its words. */
  void note(bool error, bool warning, const char *text) {
    if ((!error && !warning) || !text || std::strstr(text, "prompt")) return;
    std::string line(text);
    // sd.cpp ends each line with its source location ("--- diffusion_engine.cpp:972"): not for people.
    const auto location = line.find(" --- ");
    if (location != std::string::npos) line.resize(location);
    while (!line.empty() && std::isspace(static_cast<unsigned char>(line.back()))) line.pop_back();
    if (line.empty()) return;
    // "loading diffusion model from '<path>' failed": the file is named, so the person knows which one.
    static const std::regex fileFailed("^loading .+ from '(?:.*[/\\\\])?([^/\\\\']+)' failed$");
    std::smatch match;
    std::lock_guard<std::mutex> guard(mutex);
    if (std::regex_match(line, match, fileFailed)) unreadableFile = match[1];
    else if (error) {
      lastError = line.substr(0, 300);
      // Quoted text is a path or a name (a file can be called "alloc..."), never the engine's diagnosis.
      static const std::regex quoted("'[^']*'");
      if (std::regex_search(std::regex_replace(lastError, quoted, "''"), allocationFailurePattern()))
        allocationError = lastError;
    }
  }
  void clear() {
    std::lock_guard<std::mutex> guard(mutex);
    lastError.clear();
    allocationError.clear();
    unreadableFile.clear();
  }
  /** What a failed load says, then forget it so the next load starts clean. */
  std::string takeLoadFailure() {
    std::lock_guard<std::mutex> guard(mutex);
    std::string message;
    if (!allocationError.empty())
      message = "Not enough free memory to load the video model pack. Close other apps, then try again. (" + allocationError + ")";
    else if (!unreadableFile.empty())
      message = "The video model pack has a file that cannot be read: " + unreadableFile +
        ". Delete the model, then download it again.";
    else if (!lastError.empty())
      message = "Could not load the video model pack: " + lastError;
    else
      message = "Could not load the video model pack.";
    lastError.clear();
    allocationError.clear();
    unreadableFile.clear();
    return message;
  }
};

} // namespace offgrid
