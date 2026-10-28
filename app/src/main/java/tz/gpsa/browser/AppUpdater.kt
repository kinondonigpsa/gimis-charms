package tz.gpsa.browser

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Auto-update ya Gimis Charms (Android).
 *
 * GitHub Actions ikimaliza kujenga, inaandika taarifa ya toleo jipya kwenye Supabase (jedwali gpsa_release, safu "app-android").
 * Class hii inasoma safu hiyo (URL + anon key zinachukuliwa kutoka config.js iliyo ndani ya APK), ikiona "build" kubwa kuliko
 * iliyosakinishwa inaonyesha dirisha la kusasisha, inapakua APK na kuifungua ili Android iiweke juu ya app ya sasa.
 */
class AppUpdater(private val act: AppCompatActivity) {
    private val prefs = act.getSharedPreferences("gimis_update", Context.MODE_PRIVATE)
    @Volatile private var busy = false
    private var pendingApk: File? = null
    private var progress: AlertDialog? = null

    companion object {
        private const val TAG = "GimisUpdate"
        private const val EVERY_MS = 30L * 60 * 1000      // angalia mara moja kila dakika 30 (app ikiwa wazi)
    }

    private class Info(val version: String, val build: Long, val url: String, val size: Long, val notes: String, val required: Boolean)

    init { cleanup(); check(false) }

    /** Inaitwa kila app inaporudi mbele (onResume). */
    fun onResume() {
        val f = pendingApk
        if (f != null && f.exists() && canInstall()) { pendingApk = null; install(f); return }
        check(false)
    }

    @Suppress("DEPRECATION")
    private fun installedBuild(): Long {
        val pi = act.packageManager.getPackageInfo(act.packageName, 0)
        return if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else pi.versionCode.toLong()
    }

    private fun canInstall(): Boolean =
        Build.VERSION.SDK_INT < 26 || act.packageManager.canRequestPackageInstalls()

    // Futa APK za zamani zilizobaki kwenye cache (toleo lililopo tayari limeshasakinishwa).
    private fun cleanup() {
        try {
            val cur = installedBuild()
            File(act.cacheDir, "updates").listFiles()?.forEach { f ->
                val b = Regex("(\\d+)").find(f.name)?.groupValues?.get(1)?.toLongOrNull() ?: 0L
                if (b <= cur) f.delete()
            }
        } catch (e: Exception) { Log.w(TAG, "cleanup", e) }
    }

    /** URL ya Supabase na anon key, zinasomwa kutoka config.js ya extension iliyo ndani ya APK. */
    private fun cfg(): Pair<String, String>? {
        return try {
            val idx = JSONArray(act.assets.open("extensions/index.json").bufferedReader().use { it.readText() })
            for (i in 0 until idx.length()) {
                val dir = idx.getJSONObject(i).getString("dir")
                val js = try { act.assets.open("extensions/$dir/config.js").bufferedReader().use { it.readText() } } catch (e: Exception) { continue }
                val url = Regex("supabaseUrl\\s*:\\s*'([^']*)'").find(js)?.groupValues?.get(1)?.trim()?.trimEnd('/') ?: ""
                val key = Regex("supabaseAnonKey\\s*:\\s*'([^']*)'").find(js)?.groupValues?.get(1)?.trim() ?: ""
                if (url.isNotEmpty() && key.isNotEmpty()) return Pair(url, key)
            }
            null
        } catch (e: Exception) { null }
    }

    /** manual = true: kwa kuomba mwenyewe (inapita kikomo cha dakika 30 na inasema hata kama hakuna toleo jipya). */
    fun check(manual: Boolean) {
        if (busy) return
        val now = System.currentTimeMillis()
        if (!manual && now - prefs.getLong("last", 0L) < EVERY_MS) return
        val c = cfg() ?: return
        busy = true
        Thread {
            var info: Info? = null
            var ok = false
            try {
                val u = URL(c.first + "/rest/v1/gpsa_release?select=data&id=eq.app-android&limit=1")
                val conn = u.openConnection() as HttpURLConnection
                conn.connectTimeout = 10000; conn.readTimeout = 15000
                conn.setRequestProperty("apikey", c.second)
                if (c.second.startsWith("eyJ")) conn.setRequestProperty("Authorization", "Bearer " + c.second)
                if (conn.responseCode == 200) {
                    ok = true
                    val rows = JSONArray(conn.inputStream.bufferedReader().use { it.readText() })
                    if (rows.length() > 0) info = parse(rows.getJSONObject(0).getJSONObject("data"))
                }
            } catch (e: Exception) { Log.w(TAG, "check failed", e) }
            if (ok) prefs.edit().putLong("last", System.currentTimeMillis()).apply()
            busy = false
            val i = info
            act.runOnUiThread {
                if (i != null && i.build > installedBuild()) prompt(i)
                else if (manual) Toast.makeText(act, if (ok) "Una toleo jipya zaidi tayari." else "Imeshindwa kuangalia sasisho (angalia mtandao).", Toast.LENGTH_LONG).show()
            }
        }.start()
    }

    private fun parse(d: JSONObject): Info? {
        val kind = act.getString(R.string.device_kind)           // "phone" au "tablet" (kutoka flavor ya APK hii)
        val urls = d.optJSONObject("urls") ?: return null
        val url = urls.optString(kind, "").ifEmpty { urls.optString("phone", "") }
        if (url.isEmpty()) return null
        val sizes = d.optJSONObject("sizes")
        val build = d.optLong("build", 0L)
        val minBuild = d.optLong("minBuild", 0L)
        val cur = installedBuild()
        val required = (minBuild > 0 && cur < minBuild) || (d.optBoolean("force", false) && build > cur)
        return Info(d.optString("version", ""), build, url, sizes?.optLong(kind, 0L) ?: 0L, d.optString("notes", ""), required)
    }

    private fun prompt(i: Info) {
        if (act.isFinishing) return
        val b = AlertDialog.Builder(act)
            .setTitle("Toleo jipya la Gimis Charms")
            .setMessage("Toleo v${i.version} (build ${i.build}) liko tayari.\n\n${i.notes}".trim())
            .setPositiveButton("Sasisha sasa") { _, _ -> download(i) }
        if (i.required) b.setCancelable(false) else b.setNegativeButton("Baadaye", null)
        b.show()
    }

    private fun download(i: Info) {
        if (busy) return
        busy = true
        val dir = File(act.cacheDir, "updates"); dir.mkdirs()
        dir.listFiles()?.forEach { it.delete() }
        val out = File(dir, "gimis-charms-${i.build}.apk")
        progress = AlertDialog.Builder(act).setTitle("Inapakua sasisho").setMessage("0%").setCancelable(false).show()
        Thread {
            var err: String? = null
            try {
                val conn = URL(i.url).openConnection() as HttpURLConnection
                conn.connectTimeout = 15000; conn.readTimeout = 30000; conn.instanceFollowRedirects = true
                if (conn.responseCode != 200) throw Exception("HTTP ${conn.responseCode}")
                val total = if (conn.contentLengthLong > 0) conn.contentLengthLong else i.size
                conn.inputStream.use { ins ->
                    FileOutputStream(out).use { os ->
                        val buf = ByteArray(65536)
                        var done = 0L
                        var last = -1
                        while (true) {
                            val n = ins.read(buf)
                            if (n < 0) break
                            os.write(buf, 0, n)
                            done += n
                            if (total > 0) {
                                val pct = (done * 100 / total).toInt()
                                if (pct != last) { last = pct; act.runOnUiThread { progress?.setMessage("$pct%") } }
                            }
                        }
                    }
                }
                if (i.size > 0 && out.length() != i.size) throw Exception("Faili halijakamilika")
            } catch (e: Exception) {
                Log.e(TAG, "download failed", e)
                err = e.message ?: "hitilafu"
                out.delete()
            }
            busy = false
            act.runOnUiThread {
                progress?.dismiss(); progress = null
                if (err != null) Toast.makeText(act, "Kupakua sasisho kumeshindwa: $err", Toast.LENGTH_LONG).show()
                else install(out)
            }
        }.start()
    }

    private fun install(f: File) {
        if (!canInstall()) {
            // Android 8+: mtumiaji aruhusu app hii kusakinisha; akirudi, onResume() inaendelea na usakinishaji.
            pendingApk = f
            Toast.makeText(act, "Ruhusu \"Install unknown apps\" kwa Gimis Charms, kisha rudi hapa.", Toast.LENGTH_LONG).show()
            act.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.packageName)))
            return
        }
        try {
            val uri = FileProvider.getUriForFile(act, act.packageName + ".updateprovider", f)
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            act.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "install failed", e)
            Toast.makeText(act, "Imeshindwa kufungua usakinishaji: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }
}
