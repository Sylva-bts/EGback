# EGback - Documentation d'Hébergement

## 📋 Structure du Projet

```
EGback/
├── server/                  # Application Express
│   ├── config/              # Configuration (BD, CORS)
│   ├── controllers/         # Contrôleurs (logique métier)
│   ├── middleware/          # Middleware personnalisé
│   ├── models/              # Schémas Mongoose
│   ├── routes/              # Routes API
│   ├── utils/               # Utilitaires
│   ├── server.js            # Point d'entrée
│   └── package.json
├── public/                  # Fichiers statiques
├── .env.example             # Variables d'environnement
├── .gitignore               # Fichiers à ignorer
└── README.md

```

## 🚀 Installation Locale

### Prérequis
- Node.js >= 18.0.0
- npm >= 9.0.0
- MongoDB Atlas (ou local)

### Étapes

1. **Cloner le projet**
   ```bash
   git clone <votre-repo>
   cd EGback
   ```

2. **Installer les dépendances**
   ```bash
   cd server
   npm install
   ```

3. **Configurer les variables d'environnement**
   ```bash
   cp .env.example .env
   ```
   Remplissez `.env` avec vos valeurs :
   ```
   MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/dbname
   PORT=5000
   NODE_ENV=development
   JWT_SECRET=votre_secret_jwt
   CORS_ORIGIN=http://localhost:3000
   ```

4. **Lancer le serveur**
   ```bash
   npm run dev        # Mode développement (avec nodemon)
   npm start          # Mode production
   ```

## 🌐 Déploiement sur Heroku

### Prérequis
- Compte Heroku
- Heroku CLI installée

### Étapes

1. **Créer l'app Heroku**
   ```bash
   heroku login
   heroku create nom-app
   ```

2. **Configurer les variables d'environnement**
   ```bash
   heroku config:set MONGO_URI="votre_mongodb_uri"
   heroku config:set JWT_SECRET="votre_secret"
   heroku config:set NODE_ENV=production
   ```

3. **Déployer**
   ```bash
   git push heroku main
   ```

4. **Vérifier les logs**
   ```bash
   heroku logs --tail
   ```

## 🌐 Déploiement sur Render

### Prérequis
- Compte Render
- Lier votre repo GitHub

### Étapes

1. Aller sur [render.com](https://render.com)
2. Créer un nouveau "Web Service"
3. Connecter votre repo GitHub
4. Configurer :
   - **Build Command**: `cd server && npm install`
   - **Start Command**: `cd server && npm start`
5. Ajouter les variables d'environnement dans les paramètres

## 🌐 Déploiement sur Railway

### Étapes

1. Aller sur [railway.app](https://railway.app)
2. Nouveau projet > GitHub repo
3. Ajouter les variables d'environnement
4. Lancer automatiquement

## 🌐 Déploiement sur DigitalOcean

### Étapes

1. Créer un Droplet (Ubuntu 20.04)
2. Installer Node.js et npm
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
3. Cloner le repo et configurer
   ```bash
   git clone <repo>
   cd EGback/server
   npm install
   ```
4. Installer PM2 pour la gestion des processus
   ```bash
   sudo npm install -g pm2
   pm2 start server.js --name "egback"
   pm2 startup
   pm2 save
   ```
5. Configurer Nginx en reverse proxy
   ```bash
   sudo apt-get install nginx
   ```

## ✅ Checklist pré-déploiement

- [ ] Variables d'environnement configurées
- [ ] Base de données MongoDB configurée
- [ ] JWT_SECRET défini (long et sécurisé)
- [ ] CORS_ORIGIN mis à jour
- [ ] NODE_ENV = production
- [ ] Tous les logs éliminés (console.log)
- [ ] Erreurs gérées correctement
- [ ] Endpoints testés
- [ ] Dépendances à jour

## 📊 API Health Check

Le serveur expose un endpoint santé :
```
GET /api/health
```

Réponse :
```json
{
  "status": "OK",
  "timestamp": "2026-01-26T..."
}
```

## 🔐 Sécurité

- ✅ Variables sensibles en .env
- ✅ JWT pour l'authentification
- ✅ CORS configuré
- ✅ Validation des inputs
- ✅ Gestion des erreurs

## 📞 Support

Pour des questions sur le déploiement, consultez la documentation du service d'hébergement choisi.
