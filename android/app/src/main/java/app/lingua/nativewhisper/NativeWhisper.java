package app.lingua.nativewhisper;

final class NativeWhisper {
    static { System.loadLibrary("lingua-whisper"); }
    static native long create(String modelPath);
    static native byte[] recognize(long handle, float[] samples, String language, int threads);
    static native void cancel(long handle);
    static native void destroy(long handle);
    private NativeWhisper() {}
}
