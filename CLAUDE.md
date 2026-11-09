# 전역 작업 루틴 (모든 프로젝트 공통)
근거: E:\working 의 5개 작업규칙 .md (MyFolder, MobileBowlingClub, BowlingNote, Team_Maker, ReceiptRoad), 2026-11-06 기준.
프로그램별 규칙 파일이 이 루틴과 충돌하면 프로그램 규칙이 우선한다. 규칙 파일의 기존 문장은 사용자가 명시하기 전에는 수정·삭제·축약하지 않고, 새 규칙은 날짜 구간으로 문서 끝에 추가한다.

## 1. 모델 선택 (사용량 효율 우선)
- 기본은 Sonnet 5.5. 대부분의 개발 작업(구현·수정·버그 수정·리뷰·테스트)은 직접 처리한다.
- 단순 작업 → `haiku-helper`(Haiku): 검색, 목록 정리, 포맷 변환, 짧은 요약, 로그 추리기, 파일·ZIP 존재 확인, 일괄 치환.
- 어려운 작업 → `opus-advisor`(Opus): 설계·구조, 원인 불명 버그의 근본 원인, 여러 모듈 영향 분석, 되돌리기 어려운 결정. Sonnet이 같은 방식으로 2회 실패했을 때도 호출한다.
- 애매하면 Sonnet. 서브에이전트 결과는 요약만 받아 쓰고, 내부 로그는 사용자 화면에 노출하지 않는다.

## 2. 앱 작업 시작 순서 (모든 프로그램 공통 MASTER)
1) 요청에 해당하는 프로그램을 정하고 그 프로그램의 규칙 .md 만 읽는다(`E:\working`). 다른 프로그램의 규칙·경로·소스는 섞지 않는다.
2) 수정·적용·진행·반영·구현·변경·생성 등이 있으면 설명 요청이 아니라 실제 작업이다. 분석·예시·방향만 답하고 끝내지 않는다. '시안'만 있고 진행 의미가 없으면 소스는 고치지 않고 시안만 만든다.
3) 실제 작업은 다른 무엇보다 먼저 누적소스 폴더와 수정 대상 파일의 존재 및 READ/WRITE 권한을 확인한다. 하나라도 실패하거나 확인 불가면 문제 항목과 원인을 알리고, 수정 전 상태에서 계속할지 묻는다. 추정·우회 금지.
   (클라우드 세션처럼 D:·E:·Z: 드라이브가 보이지 않는 환경이면 이 확인이 실패한 것으로 보고 멈춘다.)
4) 권한이 정상이면 승인 질문 없이 규칙 → 작업화면 룰(A-4) 확인 후 진행한다.
5) 순서: 권한 확인 → 규칙 → 작업화면 룰 → 최신 누적소스 → 수정 대상 → 수정 → 영향 범위 점검 → 검증 → 결과물 → 누적소스 반영 → 백업 → 보고. 요청과 직접 연결된 부분만 최소 변경하고, 수정 전 백업을 만든다.
6) 완료 판단은 답변 여부가 아니라 실제 변경, 검증, 결과물·누적소스 반영, 백업 확인까지다. 하나라도 미확인·실패면 '완료'라고 쓰지 않는다.

## 3. 작업 중 화면 표시 (A-4)
- 사용자 화면에는 아래 4단계 문구와 작업 묶음별 한 줄 요약만 보여준다. 명령어·파일 탐색·내부 도구 로그·세부 목록은 노출하지 않는다.
  1. 수정 적용 방향 정리중......  2. 소스파일에 적용중......  4. 결과 출력합니다.
  3단계 문구는 프로그램마다 다르다.
  - MyFolder: `수정 적용된 최종 점검중.......`
  - 모바일 볼링클럽, 볼로그, 팀메이커, ReceiptRoad: `수정 완료된 소스파일 최종 점검중......`
- 4단계 최종 결과에는 변경 요약, 소스 적용 요약, 컴파일/정적 점검·결과물 반영, 추가 조언을 핵심만 적고, 아래 굵은 줄을 각각 따로 표시한다.
  - **누적소스 반영 여부: 반영 완료 / 미반영 / 해당 없음**
  - **백업 ZIP 저장 여부: 저장 완료 / 미저장(원인·남은 조치) / 해당 없음**
  - 빌드를 한 작업은 **릴리즈 APK·AAB 외부 복사 여부: 복사 완료(파일명·크기) / 미복사(원인·남은 조치) / 해당 없음**
- 정보 신뢰성: 확인한 사실만 쓴다. 확인 못 한 것은 '미확인' 또는 '확인 필요'로 쓰고, 빌드를 못 했으면 '빌드 미검증(Android Studio에서 확인 필요)', 화면 동작은 '실기기 확인 필요'로 구분한다.
- 외부기기·USB·다른 PC 접근이 필요하면 '외부기기 접근 승인이 필요합니다.'를 표시하고 승인 전에는 진행하지 않는다.
- 수정 후 점검: 연결된 화면·저장 구조 영향 확인. MyFolder는 듀얼모드(단일 화면 유지)와 네트워크 끊김·재연결·타임아웃도 확인한다.

## 4. 프로그램별 기준 (섞지 않는다)
| 프로그램 | 규칙 파일(E:\working) | 누적소스(D:\Pg_Edit) | 변경 ZIP(E:\working) | 백업(E:\working\backup) | 패키지명 | dist 파일명 |
|---|---|---|---|---|---|---|
| My_Folder(내파일) | 수정본_MyFolder_작업규칙_통합정리_최신.md | My_Folder | My_Folder | My_Folder | com.dobodagim.myfolder | MyFolder_V<버전>_Release.apk/.aab |
| 모바일 볼링클럽 | 수정본_MobileBowlingClub_…최신.md | BowlingClubMobile | mobile볼링클럽 | mobile볼링클럽 | com.MobileBC.app | BowlingClub_Phone_V<버전>_Release |
| 볼로그 | 수정본_BowlingNote_…최신.md | BowlingNote | 볼로그 | 볼로그 | com.bolog.app | BowlingNoteV<버전>_Release |
| 팀메이커 | 수정본_Team_Maker_…최신.md | bc_team_maker_v4 | teammaker | teammaker | com.bcteam.maker | TeamMakerV<버전>_Release |
| ReceiptRoad(소스 폴더 MoneyMile) | 수정본_ReceiptRoad_…최신.md | MoneyMile | MoneyMile | MoneyMile | com.dobodagim.ReceiptRoad | ReceiptRoad_V<버전>_Release |
| PC 볼링클럽 | (규칙 파일 미확인) | B_club | pc볼링클럽 | (미확인) | (미확인) | (미확인) |
- PC 볼링클럽은 이번에 규칙 파일을 받지 못했다. 기존 .txt 를 유지한다는 기록만 있으므로 작업 시 파일을 직접 찾아 읽고 추정하지 않는다.
- ReceiptRoad 는 앱 이름(ReceiptRoad)과 소스 폴더명(MoneyMile)을 혼동하지 않는다. 볼링 앱의 회원·로그인·Supabase 규칙은 MyFolder·ReceiptRoad 에 가져오지 않는다. ReceiptRoad 는 로컬 저장만 쓰고 서버·클라우드 OCR 은 지시 전 추가하지 않는다.
- Google Drive 동기화는 사용하지 않는다. 로컬 폴더(D:, E:, Z:)만 쓴다.
- 변경 ZIP: 실제 변경 파일만, 루트 상대경로 유지, 래퍼 폴더 없음. 파일명 끝(확장자 앞)에 `_mm_dd_HHmm`. 같은 이름 덮어쓰기 금지, 이전 ZIP 삭제 금지. 소스 안 파일은 원래 이름 유지.
- 누적소스 백업 ZIP: `프로그램명_yy_mm_dd_HHmm.zip`, 덮어쓰지 않고 누적, 생성 후 무결성 확인.
- 규칙 파일 확장자는 .md. 갱신 전 `원래파일명_백업_yy_mm_dd_HHmm.md` 백업, 갱신 후 저장 여부·크기 확인, E:\working 에만 저장.

## 5. 빌드·릴리즈 (Android 앱 공통, ReceiptRoad 포함)
- 원터치 빌드(`:app:oneTouchBuild`) = clean + 릴리즈 APK + 릴리즈 AAB. 디버그 APK 없음. `oneTouchBuild` 와 `OneTouchErrorReport` apply 줄은 지우지 않는다. 설정 파일이 없으면 요청 시에만 생성한다.
- 결과물은 dist 한 곳에만. 같은 이름이 있으면 덮어쓰지 않고 `_mm_dd_HHmm`(같은 분이면 `_2`, `_3`)을 붙인다. dist 는 요청 전 삭제하지 않는다.
- 실제 수정 후 빌드는 사용자 앱의 터미널 탭에서 실행한다(샌드박스에서는 Gradle loopback 오류 가능). 실행 전 app\build 삭제, JAVA_HOME=C:\AndroidDev\AndroidStudio\jbr, 로그 파일 남김. 'BUILD SUCCESSFUL' + 'BUILD_EXIT=0' 확인 후 dist 확인 → 변경 ZIP·백업 ZIP·무결성 → 최종 결과로 이어간다. 실패하면 오류 요약만 보고하고 고쳐서 재빌드.
- 서명 정보가 없으면 서명 안 된 파일을 내보내지 않고 중단. 서명 정보·.jks·local.properties 는 ZIP·로그·보고·복사에 넣지 않는다.
- compileSdk/targetSdk 36 이상 유지(낮추지 않음). 패키지명은 지시 없이 바꾸지 않고, 바꾸면 별개 앱이 되니 사전 고지한다.
- R8: release 에 isMinifyEnabled=true, isShrinkResources=true 유지, proguard-rules.pro 의 keep 규칙 점검. 임의로 끄지 않고, 난독화 후 '실기기 전체 기능 확인 필요'를 보고한다. mapping 은 dist·ZIP·복사 대상에서 제외.
- 외부 복사: 빌드 성공 후 dist 의 릴리즈 APK·AAB 2개를 `Z:\SupaBase\Work_Folder` 로 복사(파일명 끝 `_Release` 뒤에 `_mm_dd_HHmm`, 둘은 같은 시각). 크기·SHA256 일치 확인. Z: 가 없거나 쓸 수 없으면 우회하지 않고 보고. 5개 앱 모두 같다.
- 빌드 산출물(dist, app\build, BUILD_ERROR_SUMMARY.txt, 로그, 캐시)은 변경 ZIP·백업 ZIP·변경 판정에서 제외. app\src 등 실제 소스는 이름만으로 제외하지 않는다.
- 팀메이커 추가: 앱 이름은 TeamMaker(버전 미포함), AGP 9.0.1 / Gradle 9.1.0 이상 유지, 버전 형식 x.y.zz.

## 6. 버전 (요청이 없으면 올리지 않는다)
- 분석·점검·규칙정리·컴파일 오류 패치는 버전을 올리지 않는다.
- 버전을 올리는 작업이면 현재 versionName/versionCode 를 보여주고 권장안(마지막 자리 +1)과 함께 적용할 값을 묻는다. 응답 전에는 버전 설정 파일을 바꾸지 않는다. versionCode 는 낮추지 않는다. 형식은 앱의 현재 형식을 그대로 쓴다.
- 보고에 적용 버전/versionCode 와 근거를 쓴다. versionName, versionCode, README, 작업이력, 파일명, 화면 표시 버전을 서로 일치시킨다.
- ReceiptRoad도 같은 방식이다(2026-11-09 사용자 지시로 규칙 파일에 '버전업 확인 방식 룰' 구간 추가).

## 7. 중요 변경은 승인 후 진행
패키지명, 서버 구조(공유 서버는 영향 프로그램 확인), 삭제, 서명, 버전업, 규칙 파일 수정은 먼저 사용자 승인을 받는다. 비밀키·service role key·비밀번호는 ZIP·로그·보고에 넣지 않는다.
