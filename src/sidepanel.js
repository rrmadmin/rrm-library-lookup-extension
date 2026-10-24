// Side panel: the same card with key findings, following the active tab (view.js re-asks on
// TAB_CHANGED and keeps the last card up until the next answer is in).
import { mountView } from './lib/view.js';

mountView(document.getElementById('root'), { mode: 'panel' });
