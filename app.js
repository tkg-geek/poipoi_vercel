// 必要なモジュールのインポート
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const firebaseAdmin = require("firebase-admin");
const session = require("express-session");

// .env ファイルの設定を読み込む
dotenv.config();

// Firebase Admin SDK の初期化
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
};

firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(serviceAccount),
});

const db = firebaseAdmin.firestore();

// Express の初期設定
const app = express();
const port = process.env.PORT || 3000;

// ビューエンジンとして EJS を使用
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, "public")));

// ボディパーサー設定
app.use(express.urlencoded({ extended: true }));

// セッション設定
app.use(
  session({
    secret: process.env.SESSION_SECRET || "secret",
    resave: false,
    saveUninitialized: true,
  })
);

// ルート設定
app.get("/", (req, res) => {
  res.render("top", { session: req.session });
});

// サインアップページ
app.get("/signup", (req, res) => {
  res.render("signup", { session: req.session });
});

// サインアップ処理のルート
app.post("/signup", (req, res) => {
  const { username, email, password } = req.body;
  // Firebase Authenticationでユーザー登録
  firebaseAdmin
    .auth()
    .createUser({
      email: email,
      password: password,
    })
    .then((userRecord) => {
      console.log("User created successfully:", userRecord.uid);
      // ユーザーのFirestoreにデフォルトデータを追加（例: ポイント）
      db.collection("users")
        .doc(userRecord.uid)
        .set({
          username: username, // ユーザー名を追加
          points: 0, // 初期ポイントとして0を設定
        })
        .then(() => {
          res.redirect("/login"); // 登録後、ログインページにリダイレクト
        })
        .catch((error) => {
          console.error("Error saving user data to Firestore:", error);
          res.res.status(500).send("Error saving user data.");
        });
    })
    .catch((error) => {
      console.error("Error creating user:", error);
      res.status(500).send("Error creating user: " + error.message);
    });
});
// ログインページ
app.get("/login", (req, res) => {
  res.render("login", { session: req.session });
});

// ログイン処理
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  // Firebase Authenticationでログイン認証
  firebaseAdmin
    .auth()
    .getUserByEmail(email)
    .then((userRecord) => {
      // 認証成功したユーザーのIDでFirestoreからユーザー情報を取得
      const userId = userRecord.uid;

      db.collection("users")
        .doc(userId)
        .get()
        .then((doc) => {
          if (doc.exists) {
            // セッションにユーザーIDを保存
            req.session.userId = userId;
            req.session.username = doc.data().username;
            res.redirect("/mypage");
          } else {
            res.send("User not found");
          }
        })
        .catch((error) => {
          console.error("Error getting user data:", error);
          res.status(500).send("Error retrieving user data");
        });
    })
    .catch((error) => {
      console.error("Authentication error:", error);
      res.status(500).send("Authentication failed");
    });
});

// マイページ
// マイページ
app.get("/mypage", (req, res) => {
  const userId = req.session.userId;

  if (!userId) {
    return res.redirect("/login");
  }

  // Firestoreからユーザー情報とポイント情報を取得
  db.collection("users")
    .doc(userId)
    .get()
    .then((doc) => {
      if (doc.exists) {
        const userName = doc.data().username || "ゲスト";

        // Firestoreからポイント情報を取得
        db.collection("points")
          .get()
          .then(async (snapshot) => {
            const points = await Promise.all(
              snapshot.docs.map(async (doc) => {
                const pointData = doc.data();

                // 発行者のユーザー名を取得
                const creatorDoc = await db
                  .collection("users")
                  .doc(pointData.createdBy)
                  .get();
                const creatorName = creatorDoc.exists
                  ? creatorDoc.data().username
                  : "不明";

                return {
                  ...pointData,
                  creatorName: creatorName, // 発行者の名前を追加
                };
              })
            );

            console.log("取得した全ポイント情報:", points); // 全てのポイント情報を確認

            res.render("mypage", {
              points: points,
              userName: userName,
              session: req.session,
            });
          })
          .catch((error) => {
            console.error("ポイント情報の取得に失敗:", error);
            res.status(500).send("ポイント情報の取得に失敗しました");
          });
      } else {
        res.send("User not found");
      }
    })
    .catch((error) => {
      console.error("ユーザー情報の取得に失敗:", error);
      res.status(500).send("ユーザー情報の取得に失敗しました");
    });
});

// ログアウト処理
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send("Error during logout");
    }
    res.redirect("/login"); // ログアウト後、ログインページにリダイレクト
  });
});

// 独自ポイントの発行ページ
app.get("/issue", (req, res) => {
  res.render("issue", { session: req.session });
});

// ポイント発行処理 (POST)
app.post("/issue", (req, res) => {
  console.log("Request body:", req.body); // ここで全体を確認
  const userId = req.session.userId;

  if (!userId) {
    return res.redirect("/login");
  }

  const { "point-name": pointName, "point-description": pointDescription } =
    req.body;

  // デバッグログ
  console.log("Received point-name:", pointName);
  console.log("Received point-description:", pointDescription);

  const sanitizedPointName = pointName || null;
  const sanitizedPointDescription = pointDescription || null;

  // Firestoreへの保存処理
  db.collection("points")
    .add({
      pointName: sanitizedPointName,
      pointDescription: sanitizedPointDescription,
      createdBy: userId,
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    })
    .then(() => {
      res.redirect("/mypage");
    })
    .catch((error) => {
      console.error("Firestoreへのポイント保存に失敗:", error);
      res.status(500).send("ポイント保存に失敗しました");
    });
});

app.get("/send", (req, res) => {
  res.render("send", { session: req.session });
});

// サーバー起動
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
