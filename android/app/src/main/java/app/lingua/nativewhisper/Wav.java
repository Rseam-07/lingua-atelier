package app.lingua.nativewhisper;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

final class Wav {
    static final int RATE = 16000;
    static float[] decode(byte[] wav) throws IOException {
        if (wav.length < 44 || !tag(wav, 0, "RIFF") || !tag(wav, 8, "WAVE")) throw new IOException("需要有效的 WAV 音频。");
        ByteBuffer b = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);
        boolean format = false;
        int dataOffset = -1, dataLength = 0;
        for (int p = 12; p + 8 <= wav.length;) {
            long size = Integer.toUnsignedLong(b.getInt(p + 4));
            long end = (long) p + 8 + size;
            if (end > wav.length) throw new IOException("WAV 文件不完整。");
            if (tag(wav, p, "fmt ")) {
                if (size < 16 || b.getShort(p + 8) != 1 || b.getShort(p + 10) != 1
                        || b.getInt(p + 12) != RATE || b.getShort(p + 22) != 16) throw new IOException("需要 16 kHz、单声道、16 位 PCM WAV。");
                format = true;
            }
            if (tag(wav, p, "data")) { dataOffset = p + 8; dataLength = (int) size; }
            long next = end + (size & 1);
            if (next > wav.length) break;
            p = (int) next;
        }
        if (!format || dataOffset < 0 || dataLength % 2 != 0 || dataLength < 8000 || dataLength > RATE * 30 * 2)
            throw new IOException("音频片段需为 0.25–30 秒，原始录音不会被删除。");
        float[] samples = new float[dataLength / 2];
        for (int i = 0; i < samples.length; ++i) samples[i] = b.getShort(dataOffset + i * 2) / 32768f;
        return samples;
    }
    static byte[] encode(byte[] pcm) {
        ByteBuffer b = ByteBuffer.allocate(44 + pcm.length).order(ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + pcm.length).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII));
        b.putInt(16).putShort((short) 1).putShort((short) 1).putInt(RATE).putInt(RATE * 2).putShort((short) 2).putShort((short) 16);
        b.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(pcm.length).put(pcm);
        return b.array();
    }
    private static boolean tag(byte[] b, int p, String value) {
        for (int i = 0; i < 4; ++i) if (b[p + i] != value.charAt(i)) return false;
        return true;
    }
}
