export default {
  prefix: 'solar',
  icons: {},
  aliases: {},
  width: 24,
  height: 24,
};
export function addIcon(name, data) {
  this.icons[name] = data;
}
