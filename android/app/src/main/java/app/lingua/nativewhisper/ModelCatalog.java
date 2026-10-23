package app.lingua.nativewhisper;

final class ModelCatalog {
    // SHA-256 is the upstream LFS object ID, independently checked after every
    // download, including downloads from the user-selected mirror.
    record Model(String id, String title, long bytes, String sha256) {
        String filename() { return "ggml-" + id + ".bin"; }
        int megabytes() { return (int) Math.ceil(bytes / 1048576d); }
    }
    static final Model[] ALL = {
        new Model("small-q5_1", "Small · 识别优先", 190085487L, "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb"),
        new Model("base-q5_1", "Base · 省电均衡", 59707625L, "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898"),
        new Model("tiny-q5_1", "Tiny · 快速试用", 32152673L, "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7")
    };
    static Model get(String id) {
        for (Model model : ALL) if (model.id().equals(id)) return model;
        throw new IllegalArgumentException("请选择列表中的多语言模型。");
    }
    private ModelCatalog() {}
}
