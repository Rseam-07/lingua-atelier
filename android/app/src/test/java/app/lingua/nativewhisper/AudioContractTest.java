package app.lingua.nativewhisper;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public class AudioContractTest {
    @Test public void wavPreservesPcmAndRejectsWrongFormat() throws Exception {
        byte[] pcm = new byte[32000]; ByteBuffer b = ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN);
        b.putShort((short) -32768).putShort((short) 0).putShort((short) 16384);
        byte[] wav = Wav.encode(pcm); float[] samples = Wav.decode(wav);
        assertEquals(16000, samples.length); assertEquals(-1f, samples[0], .00001f); assertEquals(.5f, samples[2], .00001f);
        ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN).putInt(24, 48000);
        assertThrows(IOException.class, () -> Wav.decode(wav));
    }
    @Test public void malformedAndOverlongChunksFailBeforeAllocation() {
        assertThrows(IOException.class, () -> Wav.decode(new byte[20]));
        byte[] wav = Wav.encode(new byte[32000]);
        ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN).putInt(40, Integer.MAX_VALUE);
        assertThrows(IOException.class, () -> Wav.decode(wav));
        assertThrows(IOException.class, () -> Wav.decode(Wav.encode(new byte[16000 * 31 * 2])));
    }
    @Test public void oneTimePairingExpiresAndOnlyOneConcurrentConsumerWins() throws Exception {
        Pairing pairing = new Pairing(); String code = pairing.begin(1000);
        assertFalse(pairing.consume("wrong", 2000));
        ExecutorService pool = Executors.newFixedThreadPool(4); AtomicInteger accepted = new AtomicInteger();
        try {
            java.util.List<Future<?>> pending = new java.util.ArrayList<>();
            for (int i = 0; i < 8; ++i) pending.add(pool.submit(() -> { if (pairing.consume(code, 2000)) accepted.incrementAndGet(); }));
            for (Future<?> request : pending) request.get();
            assertEquals(1, accepted.get());
        } finally { pool.shutdownNow(); }
        String expired = pairing.begin(1000); assertFalse(pairing.consume(expired, 121000));
    }
    @Test public void onlyMultilingualPinnedModelsAreSelectable() {
        for (ModelCatalog.Model model : ModelCatalog.ALL) {
            assertTrue(model.sha256().matches("[a-f0-9]{64}")); assertFalse(model.id().contains(".en")); assertTrue(model.bytes() > 30000000);
        }
        assertThrows(IllegalArgumentException.class, () -> ModelCatalog.get("../../note"));
        assertTrue(BuildConfigModels.REVISION.matches("[a-f0-9]{40}"));
    }
}
