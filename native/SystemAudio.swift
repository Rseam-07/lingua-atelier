import Foundation
import ScreenCaptureKit
import CoreMedia
import CoreAudio
import CoreGraphics

// Audio-only ScreenCaptureKit bridge. No screen/video frames are subscribed to or saved.
@available(macOS 13.0, *)
final class AudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    var stream: SCStream?
    private let output = DispatchQueue(label: "lingua.system-audio")
    private var signalSource: DispatchSourceSignal?
    private var stopping = false

    func send(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }

    func start() async throws {
        guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
            throw NSError(domain: "Lingua", code: 1, userInfo: [NSLocalizedDescriptionKey:
                "请在 macOS 系统设置 → 隐私与安全性 → 屏幕与系统音频录制中允许 Obsidian，然后重启 Obsidian。"])
        }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw NSError(domain: "Lingua", code: 2, userInfo: [NSLocalizedDescriptionKey: "没有可用的系统音频来源。"])
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 16000
        config.channelCount = 1
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(seconds: 1, preferredTimescale: 1)
        config.showsCursor = false
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        self.stream = stream
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: output)
        try await stream.startCapture()
        send(["type": "ready"])
        signal(SIGTERM, SIG_IGN)
        signal(SIGINT, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler { [weak self] in
            guard let capture = self else { return }
            Task { [capture] in await capture.stop() }
        }
        source.resume()
        signalSource = source
    }

    func stop() async {
        if stopping { return }
        stopping = true
        try? await stream?.stopCapture()
        output.sync { self.send(["type": "stopped"]) }
        exit(0)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        send(["type": "error", "message": error.localizedDescription])
        exit(1)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sample.isValid,
              let format = sample.formatDescription,
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee,
              asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0 else { return }
        let frames = CMSampleBufferGetNumSamples(sample)
        guard frames > 0 else { return }
        var size = 0
        var block: CMBlockBuffer?
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, bufferListSizeNeededOut: &size,
            bufferListOut: nil, bufferListSize: 0, blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &block)
        guard size > 0 else { return }
        let raw = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        let pointer = raw.bindMemory(to: AudioBufferList.self, capacity: 1)
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, bufferListSizeNeededOut: nil,
            bufferListOut: pointer, bufferListSize: size, blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &block)
        guard status == noErr else { return }
        let buffers = UnsafeMutableAudioBufferListPointer(pointer)
        let channels = Int(asbd.mChannelsPerFrame)
        guard channels > 0 else { return }
        var mono = [Float](repeating: 0, count: frames)
        for channel in 0..<channels {
            let index = buffers.count == 1 ? 0 : channel
            guard index < buffers.count, let data = buffers[index].mData else { continue }
            let values = data.assumingMemoryBound(to: Float.self)
            let stride = buffers.count == 1 ? channels : 1
            for frame in 0..<frames { mono[frame] += values[frame * stride + (stride > 1 ? channel : 0)] / Float(channels) }
        }
        let pcm = mono.withUnsafeBytes { Data($0) }
        send(["type": "audio", "rate": asbd.mSampleRate, "pcm": pcm.base64EncodedString()])
    }
}

@main
struct Main {
    static func main() async {
        guard #available(macOS 13.0, *) else {
            FileHandle.standardOutput.write(Data("{\"type\":\"error\",\"message\":\"系统音频录制需要 macOS 13 或更新版本。\"}\n".utf8))
            exit(1)
        }
        if CommandLine.arguments.contains("--check") {
            let allowed = CGPreflightScreenCaptureAccess()
            print("{\"authorized\":\(allowed),\"audioOnly\":true}")
            return
        }
        let capture = AudioCapture()
        do {
            try await capture.start()
            // Retain the capture and service main-queue callbacks while running.
            while true { try await Task.sleep(nanoseconds: 1_000_000_000) }
        } catch {
            capture.send(["type": "error", "message": error.localizedDescription])
            exit(1)
        }
    }
}
