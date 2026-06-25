package ai.offgridmobile

import android.graphics.Color
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "OffgridMobile"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    // Switch from SplashTheme back to AppTheme once React Native loads
    setTheme(R.style.AppTheme)
    // Edge-to-edge (required for API 35+) with fully transparent system bars and
    // no contrast scrim. The default enableEdgeToEdge() adds a light scrim and
    // ties bar appearance to the system uiMode, which left the status bar white
    // in our JS-level dark theme. Transparent bars let the app's own background
    // show through and the JS <StatusBar barStyle> drive icon colour to match the
    // in-app theme at runtime.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
    )
    // Prevent restoring screen fragments for react-native-screens
    super.onCreate(null)
  }
}
