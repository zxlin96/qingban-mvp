package com.qingban.mvp;

import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapacitorWebView;

/**
 * Android 15+（targetSdk 35 起）强制 edge-to-edge：App 内容画到系统状态栏下面，
 * 轻伴顶栏与时钟/状态图标重叠。此处在原生层把「系统栏 + 刘海」的顶部 inset
 * 作为 WebView 的顶边距，使 Web 内容始终从状态栏下方开始。
 * 老系统窗口本就不延伸到状态栏下（inset 为 0），行为不变；底部留给键盘
 * adjustResize 处理，不做改动。
 * 注：工程开了 nonTransitiveRClass，不能直接引用 capacitor 模块的 R.id.webview，
 * 改为按 CapacitorWebView 类型在视图树里查找。
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    View content = findViewById(android.R.id.content);
    View web = content instanceof ViewGroup ? findWebView((ViewGroup) content) : null;
    if (web == null) return;
    ViewCompat.setOnApplyWindowInsetsListener(web, (v, windowInsets) -> {
      Insets bars = windowInsets.getInsets(
          WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
      ViewGroup.MarginLayoutParams lp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
      if (lp != null && (lp.topMargin != bars.top
          || lp.leftMargin != bars.left || lp.rightMargin != bars.right)) {
        lp.topMargin = bars.top;
        lp.leftMargin = bars.left;
        lp.rightMargin = bars.right;
        v.setLayoutParams(lp);
      }
      return windowInsets;
    });
  }

  private CapacitorWebView findWebView(ViewGroup group) {
    for (int i = 0; i < group.getChildCount(); i++) {
      View child = group.getChildAt(i);
      if (child instanceof CapacitorWebView) return (CapacitorWebView) child;
      if (child instanceof ViewGroup) {
        CapacitorWebView found = findWebView((ViewGroup) child);
        if (found != null) return found;
      }
    }
    return null;
  }
}
