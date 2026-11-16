/* 설치형(PWA) 실행용 서비스 워커: 화면은 항상 서버의 최신 파일을 쓰고, 오프라인 저장은 하지 않아요. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
