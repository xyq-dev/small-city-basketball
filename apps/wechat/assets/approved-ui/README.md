# C11 视觉素材

确认图：docs/design/C11/approved-six-screen.png。court-night及sample人物从本轮派生的纯照片三联素材导出，不含UI或文字；原始生成图SHA256 e74856cce97bca67d15d86a2cc1dc762f73e0f0b3ba6d71792e37f68d3a4d2ce，画布(1643, 957)，切片框{"court-night.jpg": [0, 0, 548, 957], "player-sample-a.jpg": [548, 100, 1096, 650], "player-sample-b.jpg": [1096, 100, 1643, 650], "player-sample-a-hero.jpg": [548, 0, 1096, 957], "player-sample-b-hero.jpg": [1096, 0, 1643, 957]}。头像sample只用于合成验收fixture，产品不按真实球员姓名/ID分配虚假照片；无公开头像字段时用player-placeholder。home-slogan是确认图中营销书法白字的透明前景，非按钮/数据截图。所有按钮、动态文字和表单均为原生元素。图标为本项目原创SVG。

运行图标及占位统一使用同源SVG导出的PNG（120px图标、320px占位），保留SVG工程源以便维护。实际控件不依赖目标微信版本的SVG显示差异。

最终头像缩略图覆盖初始导出框，A=(620,120,1035,535)，B=(1170,120,1585,535)，更贴合确认稿的脸部比例。hero仍为原完整列，通过原生widthFix在右侧72%宽按比例定位，上移50px（320上移40px），保留完整头部。
