package tz.gpsa.browser

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import android.content.Intent
import org.json.JSONArray
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebExtension
import org.mozilla.geckoview.WebRequestError
import org.mozilla.geckoview.WebResponse
import java.io.File
import java.io.FileOutputStream

/**
 * Gimis Charms: a small browser (Firefox engine) that loads the extensions placed in /extensions at build time.
 * The extensions run exactly like in a desktop browser: content scripts inside the GIMIS page, background, storage, etc.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var geckoView: GeckoView
    private lateinit var urlBar: EditText
    private val tabs = ArrayList<GeckoSession>()          // tab 0 = main page; more tabs are opened by extensions (e.g. owner console)
    private val canGoBack = HashMap<GeckoSession, Boolean>()
    private var desktopMode = false

    companion object {
        private const val TAG = "GimisCharms"
        private const val HOME = "https://gimis.gpsa.go.tz/login"
        private var runtime: GeckoRuntime? = null
    }

    private val current: GeckoSession get() = tabs.last()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        geckoView = findViewById(R.id.gecko)
        urlBar = findViewById(R.id.url)

        addHomeScreenShortcutOnce()

        val rt = runtime ?: GeckoRuntime.create(applicationContext).also { runtime = it }
        installExtensions(rt)

        val first = newSession(rt)
        tabs.add(first)
        geckoView.setSession(first)
        first.loadUri(HOME)
        urlBar.setText(HOME)

        findViewById<Button>(R.id.back).setOnClickListener { goBack() }
        findViewById<Button>(R.id.reload).setOnClickListener { current.reload() }
        findViewById<Button>(R.id.home).setOnClickListener { current.loadUri(HOME); urlBar.setText(HOME) }
        findViewById<Button>(R.id.desktop).setOnClickListener { toggleDesktop() }
        urlBar.setOnEditorActionListener { _, actionId, event ->
            if (actionId == EditorInfo.IME_ACTION_GO || (event != null && event.keyCode == KeyEvent.KEYCODE_ENTER)) {
                openTyped(); true
            } else false
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (!goBack()) finish() }
        })
    }

    // Mara ya kwanza app inapofunguliwa: inaomba kujiwekea shortcut (icon) kwenye home screen.
    // Android 8+ inaonyesha dirisha dogo "Add to home screen"; Android 7 na chini inaiweka yenyewe.
    // Launcher nyingi pia huweka icon ya app kwenye home screen yenyewe baada ya install.
    private fun addHomeScreenShortcutOnce() {
        try {
            val prefs = getSharedPreferences("gimis_charms", Context.MODE_PRIVATE)
            if (prefs.getBoolean("shortcut_requested", false)) return
            prefs.edit().putBoolean("shortcut_requested", true).apply()
            if (!ShortcutManagerCompat.isRequestPinShortcutSupported(this)) return
            val launch = Intent(this, MainActivity::class.java).setAction(Intent.ACTION_MAIN)
            val info = ShortcutInfoCompat.Builder(this, "gimis_charms_home")
                .setShortLabel(getString(R.string.app_name))
                .setLongLabel(getString(R.string.app_name))
                .setIcon(IconCompat.createWithResource(this, R.mipmap.ic_launcher))
                .setIntent(launch)
                .build()
            ShortcutManagerCompat.requestPinShortcut(this, info, null)
        } catch (e: Exception) { Log.w(TAG, "Shortcut not created", e) }
    }

    private fun newSession(rt: GeckoRuntime): GeckoSession {
        val s = GeckoSession()
        s.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onCanGoBack(session: GeckoSession, can: Boolean) { canGoBack[session] = can }

            // Bila hii, ukurasa ukishindwa kupakia unaona skrini nyeupe tu. Sasa tunaonyesha sababu halisi.
            override fun onLoadError(session: GeckoSession, uri: String?, error: WebRequestError): GeckoResult<String>? {
                val meaning = when (error.code) {
                    WebRequestError.ERROR_SECURITY_BAD_CERT -> "Cheti cha usalama (SSL certificate) cha tovuti hakikubaliki na injini hii"
                    WebRequestError.ERROR_SECURITY_SSL -> "Hitilafu ya SSL/TLS (muunganiko salama umeshindwa)"
                    WebRequestError.ERROR_UNKNOWN_HOST -> "Jina la tovuti halipatikani (DNS / hakuna mtandao)"
                    WebRequestError.ERROR_NET_TIMEOUT -> "Muda umeisha (mtandao polepole au tovuti haijibu)"
                    WebRequestError.ERROR_OFFLINE -> "Simu haina mtandao"
                    else -> "Hitilafu nyingine"
                }
                val html = "<html><body style='font-family:sans-serif;padding:16px'>" +
                    "<h2>Ukurasa haukupakia</h2>" +
                    "<p><b>$meaning</b></p>" +
                    "<p>URL: ${uri ?: ""}</p>" +
                    "<p>error.code = ${error.code}<br>error.category = ${error.category}</p>" +
                    "<p>Piga picha ya skrini hii umtumie Claude.</p></body></html>"
                return GeckoResult.fromValue("data:text/html;charset=utf-8," + java.net.URLEncoder.encode(html, "UTF-8").replace("+", "%20"))
            }
        }
        s.contentDelegate = object : GeckoSession.ContentDelegate {
            // Files generated by the extension (Excel, Word, PDF ...) arrive here as downloads.
            override fun onExternalResponse(session: GeckoSession, response: WebResponse) { saveDownload(response) }
        }
        s.open(rt)
        return s
    }

    private fun goBack(): Boolean {
        if (canGoBack[current] == true) { current.goBack(); return true }
        if (tabs.size > 1) { closeCurrentTab(); return true }
        return false
    }

    private fun closeCurrentTab() {
        val s = tabs.removeAt(tabs.size - 1)
        geckoView.releaseSession()
        s.close()
        geckoView.setSession(current)
    }

    private fun showTab(s: GeckoSession) {
        geckoView.releaseSession()
        tabs.add(s)
        geckoView.setSession(s)
    }

    private fun openTyped() {
        var t = urlBar.text.toString().trim()
        if (t.isEmpty()) return
        if (!t.contains("://")) t = if (t.contains(" ") || !t.contains(".")) "https://duckduckgo.com/?q=" + java.net.URLEncoder.encode(t, "UTF-8") else "https://$t"
        current.loadUri(t)
        (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(urlBar.windowToken, 0)
    }

    private fun toggleDesktop() {
        desktopMode = !desktopMode
        val st = current.settings
        st.userAgentMode = if (desktopMode) GeckoSessionSettings.USER_AGENT_MODE_DESKTOP else GeckoSessionSettings.USER_AGENT_MODE_MOBILE
        st.viewportMode = if (desktopMode) GeckoSessionSettings.VIEWPORT_MODE_DESKTOP else GeckoSessionSettings.VIEWPORT_MODE_MOBILE
        current.reload()
        Toast.makeText(this, if (desktopMode) "Desktop site" else "Mobile site", Toast.LENGTH_SHORT).show()
    }

    // ---- extensions: every folder in assets/extensions (prepared by tools/prepare_extensions.py) ----
    private val tabDelegate = object : WebExtension.TabDelegate {
        override fun onNewTab(source: WebExtension, createDetails: WebExtension.CreateTabDetails): GeckoResult<GeckoSession>? {
            val rt = runtime ?: return null
            val s = newSession(rt)
            runOnUiThread { showTab(s); createDetails.url?.let { s.loadUri(it) } }
            return GeckoResult.fromValue(s)
        }
    }

    private fun installExtensions(rt: GeckoRuntime) {
        val list = try {
            JSONArray(assets.open("extensions/index.json").bufferedReader().use { it.readText() })
        } catch (e: Exception) { Log.w(TAG, "No extensions found in the APK", e); return }
        for (i in 0 until list.length()) {
            val o = list.getJSONObject(i)
            val dir = o.getString("dir"); val id = o.getString("id")
            rt.webExtensionController.ensureBuiltIn("resource://android/assets/extensions/$dir/", id).accept(
                { ext ->
                    if (ext != null) {
                        ext.tabDelegate = tabDelegate; Log.i(TAG, "Extension ready: $dir ($id)")
                        runOnUiThread { Toast.makeText(this, "Extension loaded: $dir", Toast.LENGTH_SHORT).show() }
                    }
                },
                { err ->
                    Log.e(TAG, "Extension failed: $dir", err)
                    runOnUiThread { Toast.makeText(this, "Extension imeshindwa: ${err?.message}", Toast.LENGTH_LONG).show() }
                }
            )
        }
    }

    // ---- downloads ----
    private fun saveDownload(r: WebResponse) {
        Thread {
            try {
                val input = r.body ?: return@Thread
                val cd = r.headers["content-disposition"] ?: ""
                val name = Regex("filename\\*?=(?:UTF-8'')?\"?([^\";]+)\"?", RegexOption.IGNORE_CASE).find(cd)?.groupValues?.get(1)
                    ?: r.uri.substringAfterLast('/').substringBefore('?').ifEmpty { "download" }
                val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_")
                val mime = r.headers["content-type"]?.substringBefore(';') ?: "application/octet-stream"
                if (Build.VERSION.SDK_INT >= 29) {
                    val v = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, safe)
                        put(MediaStore.Downloads.MIME_TYPE, mime)
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v)!!
                    contentResolver.openOutputStream(uri)!!.use { out -> input.use { it.copyTo(out) } }
                } else {
                    val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)!!
                    FileOutputStream(File(dir, safe)).use { out -> input.use { it.copyTo(out) } }
                }
                runOnUiThread { Toast.makeText(this, "Saved to Downloads: $safe", Toast.LENGTH_LONG).show() }
            } catch (e: Exception) {
                Log.e(TAG, "Download failed", e)
                runOnUiThread { Toast.makeText(this, "Download failed", Toast.LENGTH_LONG).show() }
            }
        }.start()
    }
}
