import { createApp } from 'vue'
import App from './App.vue'
import Home from './Home.vue'
import Tutorial from './Tutorial.vue'
import Settings from './Settings.vue'
import './studio.css'
import './style.css'
import './call.css'
import './guide.css'
import './settings.css'
import './control.css'
const query = new URLSearchParams(location.search)
const app = query.has('home')
  ? Home
  : query.has('tutorial')
    ? Tutorial
    : query.has('settings')
      ? Settings
      : App
createApp(app).mount('#app')
