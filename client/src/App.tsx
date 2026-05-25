import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Host from './pages/Host'
import QuestionEditor from './pages/QuestionEditor'
import Participant from './pages/Participant'
import Home from './pages/Home'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/host/:roomId/edit" element={<QuestionEditor />} />
        <Route path="/host/:roomId" element={<Host />} />
        <Route path="/join/:roomId" element={<Participant />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
