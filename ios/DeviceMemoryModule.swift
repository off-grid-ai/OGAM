import Foundation

/// Exposes the REAL per-process memory budget to JS — not a fraction-of-total-RAM
/// guess. `os_proc_available_memory()` returns how many bytes this process can
/// still allocate before jetsam kills it, and it already reflects the
/// increased-memory + extended-virtual-addressing entitlements. This is the only
/// number that means "the OS will actually give us this much".
@objc(DeviceMemoryModule)
class DeviceMemoryModule: NSObject {

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc
  func getMemoryInfo(_ resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
    // Live headroom before this process is jetsam-killed (bytes). iOS 13+ only.
    var availableBytes = 0
    #if os(iOS)
    if #available(iOS 13.0, *) {
      availableBytes = os_proc_available_memory()
    }
    #endif

    // Current physical footprint (bytes) — useful for diagnostics / the warning UI.
    var footprintBytes: UInt64 = 0
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(
      MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) { ptr -> kern_return_t in
      ptr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { intPtr in
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), intPtr, &count)
      }
    }
    if kr == KERN_SUCCESS {
      footprintBytes = info.phys_footprint
    }

    // System-wide pages the phone can hand out without killing anything: free + inactive +
    // purgeable. os_proc_available_memory only reports this app's own limit, so it still says
    // "plenty" while the whole phone is short of pages and the OS kills the app (vm-pageshortage).
    var systemAvailableBytes: UInt64 = 0
    var vmStats = vm_statistics64_data_t()
    var vmCount = mach_msg_type_number_t(
      MemoryLayout<vm_statistics64_data_t>.size / MemoryLayout<integer_t>.size)
    let vmResult = withUnsafeMutablePointer(to: &vmStats) { ptr -> kern_return_t in
      ptr.withMemoryRebound(to: integer_t.self, capacity: Int(vmCount)) { intPtr in
        host_statistics64(mach_host_self(), HOST_VM_INFO64, intPtr, &vmCount)
      }
    }
    if vmResult == KERN_SUCCESS {
      let pages = UInt64(vmStats.free_count) + UInt64(vmStats.inactive_count) + UInt64(vmStats.purgeable_count)
      systemAvailableBytes = pages * UInt64(vm_kernel_page_size)
    }

    resolve([
      // The real budget: what this process may still allocate right now.
      "processAvailableBytes": NSNumber(value: Double(availableBytes)),
      // What the whole phone can still hand out (0 when it could not be read).
      "systemAvailableBytes": NSNumber(value: Double(systemAvailableBytes)),
      "footprintBytes": NSNumber(value: Double(footprintBytes)),
      // iOS has no system-wide low-memory flag here; the available number is authoritative.
      "lowMemory": false,
    ])
  }
}
