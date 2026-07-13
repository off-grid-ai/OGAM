// swiftlint:disable file_length
import Foundation
import UIKit
import CoreML
import React
import StableDiffusion

/// React Native bridge for Apple's ml-stable-diffusion pipeline.
/// Mirrors the Android LocalDreamModule interface so the TypeScript layer
/// can use a single abstraction via Platform.select().
@objc(CoreMLDiffusionModule)
class CoreMLDiffusionModule: RCTEventEmitter {

  // MARK: - State

  /// Both StableDiffusionPipeline and StableDiffusionXLPipeline conform to
  /// StableDiffusionPipelineProtocol, so we store whichever one was created.
  private var pipeline: StableDiffusionPipelineProtocol?
  private var loadedModelPath: String?
  private var generating = false
  private var cancelRequested = false

  // Serial queue for all pipeline operations
  private let pipelineQueue = DispatchQueue(label: "ai.offgridmobile.coreml.diffusion", qos: .userInitiated)

  override init() {
    super.init()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleMemoryWarning),
      name: UIApplication.didReceiveMemoryWarningNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func handleMemoryWarning() {
    // If we're not actively generating, release the pipeline to free memory
    guard !generating else { return }
    if pipeline != nil {
      NSLog("[CoreMLDiffusion] Memory warning received — unloading pipeline to prevent crash")
      pipeline = nil
      loadedModelPath = nil
      sendEvent(withName: "LocalDreamError", body: [
        "error": "Model unloaded due to low memory. Please try a smaller model."
      ])
    }
  }

  // MARK: - RCTEventEmitter

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["LocalDreamProgress", "LocalDreamError"]
  }

  // MARK: - SDXL detection

  /// Returns true if the model directory contains TextEncoder2.mlmodelc,
  /// which is the hallmark of an SDXL model.
  static func isXLModelDirectory(at url: URL) -> Bool {
    let te2 = url.appendingPathComponent("TextEncoder2.mlmodelc")
    return FileManager.default.fileExists(atPath: te2.path)
  }

  // MARK: - Model integrity validation

  /// SDXL iOS models may ship either a monolithic Unet.mlmodelc or split
  /// the UNet into two compiled chunks.
  static func hasValidUnetDirectory(at url: URL) -> Bool {
    let unet = url.appendingPathComponent("Unet.mlmodelc")
    if FileManager.default.fileExists(atPath: unet.path) {
      return true
    }

    let unetChunk1 = url.appendingPathComponent("UnetChunk1.mlmodelc")
    let unetChunk2 = url.appendingPathComponent("UnetChunk2.mlmodelc")
    return FileManager.default.fileExists(atPath: unetChunk1.path) &&
      FileManager.default.fileExists(atPath: unetChunk2.path)
  }

  /// Validates that the required model sub-components exist on disk before
  /// attempting to run the pipeline.  A missing TextEncoder.mlmodelc is the
  /// most common cause of the "Unexpectedly found nil" crash in
  /// TextEncoder.encode(ids:).
  static func validateModelDirectory(at url: URL) -> String? {
    let isXL = isXLModelDirectory(at: url)
    let requiredComponents = [
      "TextEncoder.mlmodelc",
      "VAEDecoder.mlmodelc"
    ]
    for component in requiredComponents {
      let path = url.appendingPathComponent(component)
      if !FileManager.default.fileExists(atPath: path.path) {
        return "Missing required model component: \(component)"
      }
    }
    if !hasValidUnetDirectory(at: url) {
      return isXL
        ? "Missing required model component: Unet.mlmodelc or UnetChunk1.mlmodelc + UnetChunk2.mlmodelc"
        : "Missing required model component: Unet.mlmodelc"
    }
    if isXL {
      let te2 = url.appendingPathComponent("TextEncoder2.mlmodelc")
      if !FileManager.default.fileExists(atPath: te2.path) {
        return "Missing required SDXL component: TextEncoder2.mlmodelc"
      }
    }
    return nil
  }

  // MARK: - loadModel

  @objc func loadModel(_ params: NSDictionary,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let modelPath = params["modelPath"] as? String else {
      reject("ERR_INVALID_PARAMS", "modelPath is required", nil)
      return
    }

    pipelineQueue.async { [weak self] in
      guard let self = self else { return }

      // Unload previous if different path
      if self.loadedModelPath != nil && self.loadedModelPath != modelPath {
        self.pipeline = nil
        self.loadedModelPath = nil
      }

      do {
        let url = URL(fileURLWithPath: modelPath)

        // Validate model files exist before attempting to load
        let isXL = Self.isXLModelDirectory(at: url)
        if let validationError = Self.validateModelDirectory(at: url) {
          reject("ERR_INVALID_MODEL", validationError, nil)
          return
        }

        let cpuOnly = params["cpuOnly"] as? Bool ?? false
        let attentionVariant = params["attentionVariant"] as? String ?? "split_einsum"

        // Build the pipeline for a given set of compute units. ANE is preferred —
        // palettized weights produce gray images on pure CPU — but on some iOS 26
        // builds loading split_einsum/palettized .mlmodelc onto the Neural Engine
        // fails instantly (rejects within ~1s). cpuAndGPU is still GPU-accelerated
        // (not pure CPU), so it decodes palettized weights correctly; we fall back
        // to it before giving up so image generation still works on those builds.
        func buildPipeline(_ units: MLComputeUnits) throws -> StableDiffusionPipelineProtocol {
          let config = MLModelConfiguration()
          config.computeUnits = units
          let built: StableDiffusionPipelineProtocol
          if isXL {
            // SDXL models need the XL pipeline which uses TextEncoderXL
            // (expects "hidden_embeds" output instead of "last_hidden_state")
            built = try StableDiffusionXLPipeline(
              resourcesAt: url,
              configuration: config,
              reduceMemory: true
            )
          } else {
            built = try StableDiffusionPipeline(
              resourcesAt: url,
              controlNet: [],
              configuration: config,
              reduceMemory: true
            )
          }
          // Skip prewarm for 'original' variant (low-memory devices): prewarm
          // loads the full Unet into memory just to unload it, causing an OOM
          // spike. With reduceMemory=true the pipeline lazily loads each submodel
          // during generateImages(), so prewarming is unnecessary.
          if attentionVariant != "original" {
            try built.loadResources()
          }
          return built
        }

        // The JS layer chooses the compute path by device RAM tier (see
        // hardwareService.preferGpuForImageGen) and sizes the residency budget to
        // match, so honor that choice here rather than guessing natively:
        //  - GPU (preferGpu): the path for devices with enough RAM. On iOS 26 the
        //    Neural Engine is degraded for these palettized .mlmodelc (the 8GB
        //    iPhone 15 Pro's ANE load fails outright), so GPU is the working path.
        //    GPU-accelerated, not pure CPU, so palettized weights decode fine.
        //  - Neural Engine (otherwise): far smaller system-RAM footprint, the only
        //    path that fits on low-RAM devices (6GB iPhone 15) where the GPU OOMs.
        let preferGpu = params["preferGpu"] as? Bool ?? false
        // Honor the parameter contract in three distinct cases: a CPU-only request must
        // NOT quietly enable the GPU (that was the bug), a preferGpu load uses CPU+GPU,
        // and everything else uses the Neural Engine.
        let primaryUnits: MLComputeUnits = cpuOnly ? .cpuOnly : (preferGpu ? .cpuAndGPU : .cpuAndNeuralEngine)
        let pipe: StableDiffusionPipelineProtocol
        do {
          pipe = try buildPipeline(primaryUnits)
        } catch {
          // Fall back ONLY from GPU → Neural Engine (the ANE uses less system RAM,
          // so it's a safe retry). Never the reverse: when JS picked the ANE for a
          // low-RAM device, retrying on the GPU would OOM the device the ANE was
          // chosen to protect.
          guard preferGpu else { throw error }
          NSLog("[CoreMLDiffusion] GPU load failed (%@) — retrying on Neural Engine", error.localizedDescription)
          pipe = try buildPipeline(.cpuAndNeuralEngine)
        }

        self.pipeline = pipe
        self.loadedModelPath = modelPath
        resolve(true)
      } catch {
        // Log the real reason — the JS layer collapses this to a generic
        // "Failed to load model" message, which hides whether it was an ANE/GPU
        // load failure or a missing/incompatible .mlmodelc component.
        NSLog("[CoreMLDiffusion] loadModel failed: %@", error.localizedDescription)
        reject("ERR_LOAD_FAILED", "Failed to load Core ML model: \(error.localizedDescription)", error)
      }
    }
  }

  // MARK: - unloadModel

  @objc func unloadModel(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter _: @escaping RCTPromiseRejectBlock) {
    pipelineQueue.async { [weak self] in
      self?.pipeline = nil
      self?.loadedModelPath = nil
      resolve(true)
    }
  }

  // MARK: - isModelLoaded

  @objc func isModelLoaded(_ resolve: @escaping RCTPromiseResolveBlock,
                           rejecter _: @escaping RCTPromiseRejectBlock) {
    resolve(pipeline != nil)
  }

  // MARK: - getLoadedModelPath

  @objc func getLoadedModelPath(_ resolve: @escaping RCTPromiseResolveBlock,
                                rejecter _: @escaping RCTPromiseRejectBlock) {
    resolve(loadedModelPath as Any)
  }

  // MARK: - generateImage

  // swiftlint:disable:next cyclomatic_complexity
  @objc func generateImage(_ params: NSDictionary,
                           resolver resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let pipe = pipeline else {
      reject("ERR_NO_MODEL", "No model loaded", nil)
      return
    }

    guard !generating else {
      reject("ERR_BUSY", "Image generation already in progress", nil)
      return
    }

    let prompt = (params["prompt"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let negativePrompt = params["negativePrompt"] as? String ?? ""
    let steps = params["steps"] as? Int ?? 20
    let guidanceScale = params["guidanceScale"] as? Double ?? 7.5
    let seed = params["seed"] as? UInt32 ?? UInt32.random(in: 0..<UInt32.max)

    // Validate prompt before sending to the pipeline — an empty prompt causes
    // TextEncoder.encode(ids:) to force-unwrap a nil value and crash.
    guard !prompt.isEmpty else {
      reject("ERR_INVALID_PROMPT", "Prompt cannot be empty", nil)
      return
    }

    generating = true
    cancelRequested = false

    pipelineQueue.async { [weak self] in
      guard let self = self else { return }

      defer { self.generating = false }

      // Re-check that pipeline hasn't been released (e.g. by a memory warning)
      guard self.pipeline != nil else {
        reject("ERR_NO_MODEL", "Model was unloaded (possibly due to low memory). Please reload and try again.", nil)
        return
      }

      do {
        var pipelineConfig = PipelineConfiguration(prompt: prompt)
        pipelineConfig.negativePrompt = negativePrompt
        pipelineConfig.stepCount = max(1, steps)
        pipelineConfig.guidanceScale = Float(guidanceScale)
        pipelineConfig.seed = seed

        let images: [CGImage?]
        do {
          images = try pipe.generateImages(configuration: pipelineConfig) { progress in
            if self.cancelRequested { return false }

            let progressValue = Double(progress.step) / Double(progress.stepCount)
            self.sendEvent(withName: "LocalDreamProgress", body: [
              "step": progress.step,
              "totalSteps": progress.stepCount,
              "progress": progressValue
            ])

            return true // continue
          }
        } catch {
          // Catch errors from the pipeline (including TextEncoder failures)
          // and convert them to a JS-visible rejection instead of crashing.
          let msg = "Pipeline failed during image generation: \(error.localizedDescription)"
          NSLog("[CoreMLDiffusion] %@", msg)
          self.sendEvent(withName: "LocalDreamError", body: ["error": msg])

          // If the error may indicate a corrupted model state, release it so
          // the next attempt triggers a fresh load.
          self.pipeline = nil
          self.loadedModelPath = nil

          reject("ERR_GENERATION", msg, error)
          return
        }

        if self.cancelRequested {
          reject("ERR_CANCELLED", "Generation was cancelled", nil)
          return
        }

        guard let cgImage = images.compactMap({ $0 }).first else {
          reject("ERR_NO_IMAGE", "Pipeline produced no image", nil)
          return
        }

        // Save to app's documents directory
        let imageId = UUID().uuidString
        guard let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
          reject("ERR_NO_DOCS_DIR", "Could not locate documents directory", nil)
          return
        }
        let generatedDir = docsDir.appendingPathComponent("generated_images")
        try FileManager.default.createDirectory(at: generatedDir, withIntermediateDirectories: true)

        let imagePath = generatedDir.appendingPathComponent("\(imageId).png")
        let uiImage = UIImage(cgImage: cgImage)
        guard let pngData = uiImage.pngData() else {
          reject("ERR_ENCODE", "Failed to encode image as PNG", nil)
          return
        }
        try pngData.write(to: imagePath)

        // Release the pipeline immediately after generation to free memory.
        // On iOS devices the CoreML pipeline holds 1-2 GB+ even when idle;
        // keeping it loaded while the user navigates causes blank screens and
        // UI hangs.  The model will auto-reload on the next generation request.
        self.pipeline = nil
        self.loadedModelPath = nil
        NSLog("[CoreMLDiffusion] Pipeline released after successful generation to reclaim memory")

        resolve([
          "id": imageId,
          "imagePath": imagePath.path,
          "width": cgImage.width,
          "height": cgImage.height,
          "seed": seed
        ] as [String: Any])

      } catch {
        if !self.cancelRequested {
          self.sendEvent(withName: "LocalDreamError", body: [
            "error": error.localizedDescription
          ])
          reject("ERR_GENERATION", "Image generation failed: \(error.localizedDescription)", error)
        } else {
          reject("ERR_CANCELLED", "Generation was cancelled", nil)
        }
      }
    }
  }

  // MARK: - cancelGeneration

  @objc func cancelGeneration(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter _: @escaping RCTPromiseRejectBlock) {
    cancelRequested = true
    resolve(true)
  }

  // MARK: - isGenerating

  @objc func isGenerating(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter _: @escaping RCTPromiseRejectBlock) {
    resolve(generating)
  }

  // MARK: - isNpuSupported (always true on Apple Silicon)

  @objc func isNpuSupported(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter _: @escaping RCTPromiseRejectBlock) {
    resolve(true)
  }

  // MARK: - getGeneratedImages

  @objc func getGeneratedImages(_ resolve: @escaping RCTPromiseResolveBlock,
                                rejecter _: @escaping RCTPromiseRejectBlock) {
    guard let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
      resolve([])
      return
    }
    let generatedDir = docsDir.appendingPathComponent("generated_images")

    guard let files = try? FileManager.default.contentsOfDirectory(
      at: generatedDir, includingPropertiesForKeys: [.creationDateKey], options: .skipsHiddenFiles
    ) else {
      resolve([])
      return
    }

    let images: [[String: Any]] = files
      .filter { $0.pathExtension == "png" }
      .compactMap { url in
        let id = url.deletingPathExtension().lastPathComponent
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let createdAt = (attrs?[.creationDate] as? Date)?.iso8601String ?? ""

        return [
          "id": id,
          "prompt": "",
          "imagePath": url.path,
          "width": 512,
          "height": 512,
          "steps": 0,
          "seed": 0,
          "modelId": "",
          "createdAt": createdAt
        ] as [String: Any]
      }

    resolve(images)
  }

  // MARK: - deleteGeneratedImage

  @objc func deleteGeneratedImage(_ imageId: String,
                                  resolver resolve: @escaping RCTPromiseResolveBlock,
                                  rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
      reject("ERR_NO_DOCS_DIR", "Could not locate documents directory", nil)
      return
    }
    let imagePath = docsDir
      .appendingPathComponent("generated_images")
      .appendingPathComponent("\(imageId).png")

    do {
      try FileManager.default.removeItem(at: imagePath)
      resolve(true)
    } catch {
      resolve(false)
    }
  }
}

// MARK: - Date helper

private extension Date {
  var iso8601String: String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: self)
  }
}
