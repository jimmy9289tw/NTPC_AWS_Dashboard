import { createRoot } from 'react-dom/client';
import { LsfWorkbench } from '../../app/lsf-workbench';
import '../../app/globals.css';
import '../../app/workspace-ui.css';
import './preview.css';
createRoot(document.getElementById('root')!).render(<><a className="lsf-skip" href="#main">跳至主要內容</a><header className="lsf-preview-header"><h1>新北青年政策決策工作台</h1><span>本機研究原型 · LSF V1</span></header><main id="main" className="lsf-preview-main"><LsfWorkbench/></main></>);
