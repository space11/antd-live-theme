#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const glob = require('glob');
const postcss = require('postcss');
const less = require('less');

const antd = path.resolve(__dirname, './node_modules/antd/');
const themeFile = path.join(__dirname, './src/styles/variables.less');
const variables = getLessVars(themeFile);
const bezierEasing = fs.readFileSync(path.join(antd, 'lib/style/color/bezierEasing.less')).toString();
const tinyColor = fs.readFileSync(path.join(antd, 'lib/style/color/tinyColor.less')).toString();
const colorPalette = fs.readFileSync(path.join(antd, 'lib/style/color/colorPalette.less'))
  .toString()
  .replace('@import "bezierEasing";', '')
  .replace('@import "tinyColor";', '');
const scripts = `${bezierEasing}\n${tinyColor}\n${colorPalette}\n`;
const reducePlugin = postcss.plugin('reducePlugin', () => {
  const cleanRule = (rule) => {
    if (rule.selector.startsWith('.main-color .palatte-')) {
      rule.remove();
      return;
    }
    let removeRule = true;
    rule.walkDecls((decl) => {
      if (
        !decl.prop.includes('color') &&
        !decl.prop.includes('background') &&
        !decl.prop.includes('border') &&
        !decl.prop.includes('box-shadow')
      ) {
        decl.remove();
      } else {
        removeRule = false;
      }
    });
    if (removeRule) {
      rule.remove();
    }
  };
  return (css) => {
    css.walkAtRules((atRule) => {
      atRule.remove();
    });

    css.walkRules(cleanRule);

    css.walkComments(c => c.remove());
  };
});
const entry = path.join(antd, 'lib/style/index.less');
let content = fs.readFileSync(entry).toString();
const styles = glob.sync(path.join(antd, 'lib/*/style/index.less'));
content += '\n';
styles.forEach((style) => {
  content += `@import "${style}";\n`;
});

render(content).then(({ css }) => {
  return postcss([
    reducePlugin,
  ]).process(css, { parser: less.parser, from: entry });
})
  .then(({ css }) => {
    replacePrimaryColors().then(mappings => {
      const colorToNames = mappings['cTn'];
      Object.keys(colorToNames).forEach(color => {
        const varName = colorToNames[color];
        if (varName in variables) {
          console.log(varName, color, color.length);
          color = color.replace('(', '\\(').replace(')', '\\)');
          css = css.replace(new RegExp(`${color}`, 'g'), `${varName}`);
        }
      });

      css = `${scripts}\n${css}`;
      Object.keys(variables).forEach(varName => {
        css = `${varName}: ${variables[varName]};\n${css}`;
      });
      fs.writeFileSync(path.resolve(__dirname, './public/color.less'), css);
    });
  })
  .catch(error => {
    console.log('Error', error);
  });



function generateColorMappings() {
  const defaultLess = path.join(antd, 'lib/style/themes/default.less');
  const colorFile = path.join(antd, 'lib/style/color/colors.less');
  let colors = fs.readFileSync(colorFile).toString();
  colors = colors.split('\n')
    .filter(line => line.startsWith('@') && line.indexOf(':') > -1
    ).reduce((prev, next) => {
      const [, varName, color] = next.match(/(?=\S*['-])([@a-zA-Z0-9'-]+).*:[ ]{1,}(.*);/);
      prev['cTn'][color] = varName;
      prev['nTc'][varName] = color;

      return prev;
    }, { 'cTn': {}, 'nTc': {} });
  const defaultLessColors = fs.readFileSync(defaultLess).toString();
  content = defaultLessColors;
  const mappings = content.split('\n')
    .filter(line => line.startsWith('@') && line.indexOf(':') > -1
    ).reduce((prev, next) => {
      try {
        let [, varName, color] = next.match(/(?=\S*['-])([@a-zA-Z0-9'-]+).*:[ ]{1,}(.*);/);
        if (varName in variables || varName.includes('@primary')) {
          if (color in colors['nTc']) color = colors['nTc'][color];
          color = color.startsWith('@') ? (prev['nTc'][color] ? prev['nTc'][color] : color) : color;
          if (color in prev['cTn']) return prev;
          prev['cTn'][color] = varName;
          prev['nTc'][varName] = color.startsWith('@') ? (prev[color] ? prev[color][color] : color) : color
          return prev;
        }
        return prev;
      } catch (e) {
        console.log('e', e);
        return prev;
      }
    }, { 'cTn': {}, 'nTc': {} });
  return mappings;
}

function replacePrimaryColors() {
  const mappings = generateColorMappings();
  let css = '';
  const varNames = Object.keys(variables);
  varNames.forEach(varName => {
    const color = mappings['nTc'][varName];
    css = `.${varName.replace('@', '')} { color: ${color}; }\n ${css}`;
  });


  varNames.forEach(varName => {
    css = `${scripts}\n${varName}: ${mappings['nTc'][varName]};\n${css}`;
  });
  Object.keys(mappings['nTc']).forEach(varName => {
    if (varName !== '@primary-color' && varName.includes('@primary-')) {
      const color = mappings['nTc'][varName];
      delete mappings['cTn'][color];
      mappings['cTn'][varName] = color;
      css = `.${varName.replace('@', '')} { color: ${color}; }\n ${css}`;
    }
  });
  css = `${scripts}\n@primary-color: ${mappings['nTc']['@primary-color']};\n${css}`;
  return render(css).then(({ css }) => {
    css = css.replace(/(\/.*\/)/g, '');
    const regex = /.(?=\S*['-])([.a-zA-Z0-9'-]+)\ {\n\ \ color:\ (.*);/g;
    const vars = getMatches(css, regex);
    const classes = Object.keys(vars);
    classes.forEach((cls, index) => {
      if (cls.match('primary-\d\d?')) {
        const colorName = mappings['cTn'][cls]
        delete mappings['cTn'][cls];
        mappings['cTn'][vars[cls]] = colorName;
      } else {
        mappings['cTn'][vars[cls]] = cls;
      }

    });
    return mappings;
  }).catch(error => {
    console.log(error);
  });
}

function getMatches(string, regex) {
  let matches = {};
  var match;
  while (match = regex.exec(string)) {
    if (match[2].startsWith('rgba') || match[2].startsWith('#')) {
      matches[`@${match[1]}`] = match[2];
    }
  }
  return matches;
}

function render(content) {
  return less.render.call(less, content, {
    paths: [path.join(antd, 'lib/styles'), path.join(antd, 'lib/style')],
    javascriptEnabled: true
  }).catch(error => {
    console.log('Error', error);
    return { mappings, variables };
  });
}

function getLessVars(filtPath) {
  const sheet = fs.readFileSync(filtPath).toString();
  const lessVars = {};
  const matches = sheet.match(/@(.*:[^;]*)/g) || [];

  matches.forEach(variable => {
    const definition = variable.split(/:\s*/);
    lessVars[definition[0].replace(/['"]+/g, '').trim()] = definition.splice(1).join(':');
  });

  return lessVars;
};
module.exports = {
  getLessVars
};