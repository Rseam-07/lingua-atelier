package app.lingua.nativewhisper;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;

/** A user-created, one-use pairing window. Persistent bearer tokens never enter URLs. */
final class Pairing {
    private String code = "";
    private long expires;
    static String random() {
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format("%02x", b & 255));
        return out.toString();
    }
    synchronized String begin(long now) { code = random(); expires = now + 120000; return code; }
    synchronized boolean consume(String supplied, long now) {
        if (now >= expires || code.isEmpty() || !equal(code, supplied)) return false;
        code = ""; expires = 0; return true;
    }
    static boolean equal(String a, String b) {
        return a != null && b != null && MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }
}
