# TANK.io (멀티플레이)

diep.io 스타일 탱크 게임. 서버(Node.js + WebSocket)가 게임을 계산하고, 접속한 사람들이 같은 맵에서 함께 싸워요.
사람이 적으면 봇이 빈자리를 채우고, 사람이 늘면 봇이 줄어요.

## 내 컴퓨터에서 실행
    npm install
    npm start
브라우저에서 http://localhost:3000 을 열어요. 같은 와이파이의 다른 기기는 http://내컴퓨터IP:3000 으로 접속하면 돼요.

## Render에 배포 (Web Service)
1. 이 폴더의 파일을 GitHub 저장소 맨 위에 올려요. (server.js, package.json, package-lock.json, render.yaml, public/)
2. Render에서 New > Web Service 를 누르고 저장소를 연결해요.
3. 아래처럼 입력하고 Create Web Service:
   - Language(Runtime): Node
   - Build Command: npm install
   - Start Command: node server.js
   - Instance Type: Free
4. 배포가 끝나면 나오는 https://...onrender.com 주소로 접속해요.

## 설정값 (Render의 Environment 에서 변경)
- MAX_PLAYERS: 동시 접속 최대 인원 (기본 30)
- MIN_TANKS: 맵에 항상 있을 최소 탱크 수, 모자라면 봇으로 채움 (기본 10)

## 참고
- Render 무료 웹 서비스는 한동안 접속이 없으면 잠들어요. 첫 접속은 1분쯤 걸릴 수 있어요.
- 서버가 재시작되면 점수와 레벨은 모두 사라져요.
