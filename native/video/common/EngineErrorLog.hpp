#pragma once
// stable-diffusion.cpp says why a load failed only in its log: new_sd_ctx returns null. The bindings pass
// each log line here, and a failed load names the last error instead of a bare "could not load".
#include <cctype>
#include <cstring>
#include <mutex>
#include <regex>
#include <string>

namespace offgrid {

class EngineErrorLog {
  std::mutex mutex;
  std::string last;
public:
  /** Keep the latest error line. Lines that mention the prompt are dropped: they can carry its words. */
  void note(bool error, const char *text) {
    if (!error || !text || std::strstr(text, "prompt")) return;
    std::string line(text);
    while (!line.empty() && std::isspace(static_cast<unsigned char>(line.back()))) line.pop_back();
    if (line.empty()) return;
    if (line.size() > 300) line.resize(300);
    std::lock_guard<std::mutex> guard(mutex);
    last = line;
  }
  void clear() {
    std::lock_guard<std::mutex> guard(mutex);
    last.clear();
  }
  std::string take() {
    std::lock_guard<std::mutex> guard(mutex);
    std::string reason;
    reason.swap(last);
    return reason;
  }
};

/** What the person reads when no backend could open the video model pack, with the engine's reason. */
inline std::string videoPackLoadFailure(const std::string &reason) {
  if (reason.empty()) return "Could not load the video model pack.";
  static const std::regex memory("alloc|out of memory|\\bOOM\\b", std::regex::icase);
  if (std::regex_search(reason, memory))
    return "Not enough free memory to load the video model pack. Close other apps, then try again. (" + reason + ")";
  return "Could not load the video model pack: " + reason;
}

} // namespace offgrid
