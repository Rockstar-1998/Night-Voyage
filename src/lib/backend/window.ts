import { invokeCommand } from './internal';

export async function showWindow() {
  return invokeCommand('show_window');
}
