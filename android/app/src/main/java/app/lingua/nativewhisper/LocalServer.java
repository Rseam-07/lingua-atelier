package app.lingua.nativewhisper;

import fi.iki.elonen.NanoHTTPD;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.util.Locale;

final class LocalServer extends NanoHTTPD {
    static final int PORT = 8179;
    private final WhisperService service;
    LocalServer(WhisperService service) { super("127.0.0.1", PORT); this.service = service; }
    @Override public Response serve(IHTTPSession request) {
        try {
            if (request.getMethod() == Method.POST && request.getUri().equals("/pair")) {
                JSONObject data = body(request, 1024);
                if (!service.pairing.consume(data.optString("code"), android.os.SystemClock.elapsedRealtime())) return error(Response.Status.UNAUTHORIZED, "连接码已过期，请在本机识别 App 再次点击连接。");
                return json(Response.Status.OK, new JSONObject().put("engine", "lingua-whisper-android").put("protocol", 1).put("token", service.token));
            }
            if (!Pairing.equal("Bearer " + service.token, request.getHeaders().get("authorization"))) return error(Response.Status.UNAUTHORIZED, "请从本机识别 App 点击连接 Obsidian。");
            if (request.getMethod() == Method.GET && request.getUri().equals("/health")) {
                JSONArray models = new JSONArray();
                for (ModelCatalog.Model model : ModelCatalog.ALL) models.put(new JSONObject().put("id", model.id()).put("ready", service.models.ready(model)));
                return json(Response.Status.OK, new JSONObject().put("status", "ok").put("engine", "lingua-whisper-android").put("protocol", 1)
                    .put("active_model", service.engine.active()).put("backend", "native-cpu").put("models", models).put("busy", service.engine.busy()));
            }
            if (request.getMethod() == Method.POST && request.getUri().equals("/load")) {
                service.engine.load(body(request, 1024).getString("model_id"));
                return json(Response.Status.OK, new JSONObject().put("status", "ok").put("model_id", service.engine.active()));
            }
            if (request.getMethod() == Method.POST && request.getUri().equals("/inference")) {
                String contentType = request.getHeaders().getOrDefault("content-type", "").toLowerCase(Locale.ROOT);
                if (!contentType.startsWith("audio/wav")) return error(Response.Status.UNSUPPORTED_MEDIA_TYPE, "需要 PCM WAV。");
                byte[] wav = read(request, 1024 * 1024);
                String language = request.getHeaders().getOrDefault("x-language", "auto");
                String model = request.getHeaders().getOrDefault("x-model-id", "small-q5_1");
                int threads = Integer.parseInt(request.getHeaders().getOrDefault("x-threads", "4"));
                return json(Response.Status.OK, service.engine.transcribe(wav, model, language, threads));
            }
            return error(Response.Status.NOT_FOUND, "没有这个接口。");
        } catch (IllegalStateException busy) {
            return error(Response.Status.CONFLICT, busy.getMessage());
        } catch (Exception failure) {
            return error(Response.Status.BAD_REQUEST, failure.getMessage() == null ? "处理未完成，原始录音保留。" : failure.getMessage());
        }
    }
    private static JSONObject body(IHTTPSession request, int max) throws Exception { return new JSONObject(new String(read(request, max), java.nio.charset.StandardCharsets.UTF_8)); }
    private static byte[] read(IHTTPSession request, int max) throws IOException {
        String length = request.getHeaders().get("content-length");
        if (length == null || !length.matches("[0-9]{1,8}")) throw new IOException("需要明确的音频长度。");
        int size = Integer.parseInt(length);
        if (size <= 0 || size > max) throw new IOException("音频片段过大，请使用 30 秒以内分段。");
        byte[] bytes = new byte[size]; int offset = 0;
        while (offset < size) { int count = request.getInputStream().read(bytes, offset, size - offset); if (count < 0) throw new EOFException("音频传输不完整。"); offset += count; }
        return bytes;
    }
    private static Response error(Response.Status status, String message) {
        try { return json(status, new JSONObject().put("error", message)); }
        catch (Exception ignored) { return newFixedLengthResponse(status, "application/json", "{\"error\":\"Request failed\"}"); }
    }
    private static Response json(Response.Status status, JSONObject value) {
        Response response = newFixedLengthResponse(status, "application/json; charset=utf-8", value.toString());
        response.addHeader("Cache-Control", "no-store"); response.addHeader("X-Content-Type-Options", "nosniff");
        return response;
    }
}
