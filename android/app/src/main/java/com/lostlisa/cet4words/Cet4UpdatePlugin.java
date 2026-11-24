package com.lostlisa.cet4words;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

/**
 * 侧载更新只存在于安卓壳里：拉取 GitHub Releases、下载约定命名的 APK，再交给系统安装器。
 * 检查失败时向页面返回 ok:false。启动后的自动检查会静默忽略；「我的」里的手动检查会告诉用户。
 */
@CapacitorPlugin(name = "Cet4Update")
public class Cet4UpdatePlugin extends Plugin {
    private static final String RELEASES_URL =
        "https://api.github.com/repos/2817764844/NDKY-English-1000word/releases?per_page=30";
    private static final int MAX_BYTES = 80 * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;

    private volatile boolean cancelDownload = false;
    private volatile HttpURLConnection activeConnection = null;

    @PluginMethod
    public void getVersion(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("versionName", getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName);
            result.put("versionCode", installedVersionCode());
            call.resolve(result);
        } catch (Exception error) {
            call.resolve(failed());
        }
    }

    @PluginMethod
    public void fetchReleases(PluginCall call) {
        new Thread(() -> call.resolve(readReleases())).start();
    }

    @PluginMethod
    public void downloadApk(PluginCall call) {
        String url = call.getString("url");
        cancelDownload = false;
        new Thread(() -> call.resolve(download(url))).start();
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelDownload = true;
        HttpURLConnection connection = activeConnection;
        if (connection != null) {
            connection.disconnect();
        }
        call.resolve();
    }

    @PluginMethod
    public void canRequestInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", canInstallPackages());
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (getActivity() == null) {
            call.resolve(failed());
            return;
        }
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName())
        );
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startActivity(intent);
                call.resolve();
            } catch (Exception error) {
                call.resolve(failed());
            }
        });
    }

    @PluginMethod
    public void installDownloaded(PluginCall call) {
        if (!canInstallPackages()) {
            JSObject result = failed();
            result.put("reason", "permission");
            call.resolve(result);
            return;
        }
        File file = updateFile();
        if (!file.exists() || file.length() < 1024) {
            JSObject result = failed();
            result.put("reason", "missing");
            call.resolve(result);
            return;
        }
        if (getActivity() == null) {
            call.resolve(failed());
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file
                );
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.setClipData(ClipData.newRawUri("", uri));
                getActivity().startActivity(intent);
                JSObject result = new JSObject();
                result.put("ok", true);
                call.resolve(result);
            } catch (Exception error) {
                call.resolve(failed());
            }
        });
    }

    private long installedVersionCode() throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).getLongVersionCode();
        }
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionCode;
    }

    private boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return true;
        }
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    private File updateFile() {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return new File(dir, "cet4-update.apk");
    }

    private JSObject readReleases() {
        HttpURLConnection connection = null;
        try {
            connection = open(new URL(RELEASES_URL));
            connection.setRequestProperty("Accept", "application/vnd.github+json");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                return failed();
            }
            InputStream stream = connection.getInputStream();
            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int count;
            int total = 0;
            while ((count = stream.read(chunk)) != -1 && total < 1024 * 1024) {
                buffer.write(chunk, 0, count);
                total += count;
            }
            stream.close();
            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("body", new String(buffer.toByteArray(), java.nio.charset.StandardCharsets.UTF_8));
            return result;
        } catch (Exception error) {
            return failed();
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private JSObject download(String rawUrl) {
        HttpURLConnection connection = null;
        File partial = null;
        try {
            URL current = new URL(rawUrl);
            if (!isAllowed(current, true)) {
                return failed();
            }
            for (int redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
                connection = open(current);
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(20000);
                activeConnection = connection;
                int status = connection.getResponseCode();
                if (status == HttpURLConnection.HTTP_MOVED_PERM ||
                    status == HttpURLConnection.HTTP_MOVED_TEMP ||
                    status == HttpURLConnection.HTTP_SEE_OTHER ||
                    status == 307 ||
                    status == 308) {
                    String location = connection.getHeaderField("Location");
                    connection.disconnect();
                    connection = null;
                    if (location == null) {
                        return failed();
                    }
                    current = new URL(current, location);
                    if (!isAllowed(current, false)) {
                        return failed();
                    }
                    continue;
                }
                if (status != HttpURLConnection.HTTP_OK) {
                    return failed();
                }
                int length = connection.getContentLength();
                if (length > MAX_BYTES) {
                    return failed();
                }
                partial = new File(updateFile().getParentFile(), "cet4-update.part");
                InputStream input = connection.getInputStream();
                FileOutputStream output = new FileOutputStream(partial);
                byte[] buffer = new byte[16 * 1024];
                int read;
                long total = 0;
                int lastPercent = -1;
                while ((read = input.read(buffer)) != -1) {
                    if (cancelDownload) {
                        output.close();
                        input.close();
                        partial.delete();
                        return failed();
                    }
                    total += read;
                    if (total > MAX_BYTES) {
                        output.close();
                        input.close();
                        partial.delete();
                        return failed();
                    }
                    output.write(buffer, 0, read);
                    int percent = length > 0 ? (int) (total * 100 / length) : -1;
                    if (percent != lastPercent) {
                        lastPercent = percent;
                        JSObject event = new JSObject();
                        event.put("percent", percent);
                        notifyListeners("downloadProgress", event);
                    }
                }
                output.close();
                input.close();
                File target = updateFile();
                if (target.exists() && !target.delete()) {
                    return failed();
                }
                if (!partial.renameTo(target)) {
                    return failed();
                }
                JSObject result = new JSObject();
                result.put("ok", true);
                return result;
            }
            return failed();
        } catch (Exception error) {
            if (partial != null && partial.exists()) {
                partial.delete();
            }
            return failed();
        } finally {
            activeConnection = null;
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private HttpURLConnection open(URL url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestProperty("User-Agent", "cet4-words-android");
        connection.setRequestProperty("Accept", "*/*");
        return connection;
    }

    private boolean isAllowed(URL url, boolean requireReleasePath) {
        if (!"https".equalsIgnoreCase(url.getProtocol())) {
            return false;
        }
        String host = url.getHost().toLowerCase(Locale.ROOT);
        boolean github = "github.com".equals(host);
        boolean cdn = host.endsWith(".githubusercontent.com");
        if (!github && !cdn) {
            return false;
        }
        if (requireReleasePath && !url.getPath().contains("/releases/download/")) {
            return false;
        }
        return true;
    }

    private JSObject failed() {
        JSObject result = new JSObject();
        result.put("ok", false);
        return result;
    }
}
