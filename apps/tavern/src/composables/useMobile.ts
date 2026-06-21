/**
 * useMobile — 检测微信 / 移动端 UA,提供移动专项 UI 调整开关。
 *
 *  - isWechat: 微信内置浏览器(需特殊处理:发送按钮、visibility 后台、无 Enter 发送)
 *  - isMobile: 任意移动端(含微信)
 *  - isIOS: iOS Safari / 微信 iOS(安全区 padding 与 viewport-fit 差异)
 *  - enableEnterToSend: 仅桌面端允许 Enter 发送(移动端禁用防误触换行)
 *  - safeAreaInset: 解析 env(safe-area-inset-*) 失败时的 fallback
 */
import { computed, ref, onMounted } from 'vue';

export function useMobile() {
  const ua = ref('');

  onMounted(() => {
    ua.value = navigator.userAgent;
  });

  const isWechat = computed(
    () => /MicroMessenger/i.test(ua.value) || /wechatdevtools/i.test(ua.value),
  );
  const isIOS = computed(() => /iphone|ipad|ipod|ios/i.test(ua.value));
  const isAndroid = computed(() => /android/i.test(ua.value));
  const isMobile = computed(
    () => isWechat.value || isIOS.value || isAndroid.value || /Mobi|Android|iPhone/i.test(ua.value),
  );

  /** 仅桌面端允许 Enter 发送(移动端禁用,改用独立按钮,防误触)。 */
  const enableEnterToSend = computed(() => !isMobile.value);

  /** 安全区 padding(CSS 字符串,已含 env() 与 fallback)。 */
  const safeAreaStyle = computed(
    () => ({
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
      paddingLeft: 'env(safe-area-inset-left)',
      paddingRight: 'env(safe-area-inset-right)',
    }),
  );

  return {
    ua,
    isWechat,
    isIOS,
    isAndroid,
    isMobile,
    enableEnterToSend,
    safeAreaStyle,
  };
}
