import { createRoot } from 'react-dom/client'
import '../styles.css'
import { Film } from './Film'

document.body.dataset.surface = 'film'
createRoot(document.getElementById('root')!).render(<Film />)
