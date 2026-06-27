# piano_helper

一个面向钢琴练习的瀑布流网页项目。

当前版本特性：
- 支持多首 MIDI 曲目切换
- 双手下落练习
- 新手简化编配
- 手机省电模式
- Canvas 瀑布流渲染
- 长音按键高亮保持
- 本地静态服务启动

## 目录结构

```text
piano_helper/
  public/
    index.html
    app.js
    styles.css
    song-library.json
    song-data.json
    songs/
  scripts/
    static-server.js
    parse_midi.py
    export_midi_json.py
```

## 本地运行

需要本机安装 Node.js。

在项目目录执行：

```powershell
node .\scripts\static-server.js .\public 8124
```

启动后可访问：

```text
http://127.0.0.1:8124
```

局域网访问时，把 `127.0.0.1` 换成你电脑的局域网 IP。

## MIDI 数据处理

项目附带两个脚本：

- `scripts/parse_midi.py`
  读取 `.mid` 文件并解析出基础音符信息
- `scripts/export_midi_json.py`
  把 `.mid` 导出为页面可直接使用的 JSON 结构

示例：

```powershell
python .\scripts\export_midi_json.py D:\path\to\song.mid D:\code_room\piano_helper\public\songs\new-song.json
```

如果新增多首歌，记得同步更新 `public/song-library.json`。

## 当前曲库

- 富士山下
- 花海
- 青花瓷
- 晴天

## 说明

这个目录已经整理为独立项目目录，可直接继续开发、提交到远程仓库，或接着扩展成更完整的钢琴练习工具。
