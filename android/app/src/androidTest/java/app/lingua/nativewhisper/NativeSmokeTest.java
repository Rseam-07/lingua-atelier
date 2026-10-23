package app.lingua.nativewhisper;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import android.content.Context;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.*;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class NativeSmokeTest {
    @Test public void actualQuantizedModelRunsTwiceInOneResidentNativeContext() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File model = new File(context.getFilesDir(), "ci-model.bin");
        assertEquals(32152673L, model.length());
        ByteArrayOutputStream audio = new ByteArrayOutputStream();
        try (InputStream input = new FileInputStream(new File(context.getFilesDir(), "ci-sample.wav"))) {
            byte[] buffer = new byte[8192]; int count; while ((count = input.read(buffer)) >= 0) audio.write(buffer, 0, count);
        }
        float[] samples = Wav.decode(audio.toByteArray());
        long handle = NativeWhisper.create(model.getAbsolutePath()); assertNotEquals(0, handle);
        try {
            for (int i = 0; i < 2; ++i) {
                long began = System.nanoTime();
                JSONObject result = new JSONObject(new String(NativeWhisper.recognize(handle, samples, "en", 2), StandardCharsets.UTF_8));
                System.out.println("LINGUA_NATIVE_SMOKE " + result.put("inference_ms", (System.nanoTime() - began) / 1000000).put("pass", i + 1));
                assertTrue(result.getString("text").toLowerCase(java.util.Locale.ROOT).contains("fellow"));
                assertEquals("en", result.getString("language"));
            }
        } finally { NativeWhisper.destroy(handle); }
    }
}
