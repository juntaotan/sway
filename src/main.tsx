import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'animal-island-ui/style'
import './styles.css'
import App from './App'
import { PoseRecognitionCameraDebug } from './pose-recognition/PoseRecognitionCameraDebug'

const isPoseRecognitionDebug = window.location.pathname === '/pose-recognition-debug'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPoseRecognitionDebug ? <PoseRecognitionCameraDebug /> : <App />}
  </StrictMode>,
)
