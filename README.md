# MatriQ Academic Tree

探索量子物理研究者之间的科研与职业关联。支持中英文姓名、机构和论文搜索，人物名录、机构筛选、一至三度图谱展开、最短关系路径、SVG 导出和来源记录查看。

在线访问：[MatriQ Academic Tree](https://sputnik-odyssey.github.io/matriq-academic-tree/)

## 界面和指导关系类型

网站的整体背景、蓝灰配色与 Times New Roman 衬线字体延续 MatriQ Atom Lab。较浅的背景仅用于层级视图和网络视图的图谱画布。

**指导关系类型按用户对工作簿列的定义显示**：`Research Line`（N 列）中引用的人物是该行人物的 PhD 导师，使用红色实线；`Industry Line`（O 列）中引用的人物是该行人物的 Postdoc 导师，使用橙色虚线。箭头均由所引用的导师指向该行学生或受指导者。两种关系都带有阶段标签，使关系类型不依赖颜色也能辨认。同一人物可以分别连接 PhD 与 Postdoc 关系，每条边按自己的来源列显示。

人物边框保持中性，当前选中人物可用黑框或选中标记强调。N / O 列中的全部有效人物关联均按上述规则着色，不以是否有外部核验记录作为显示条件。其他未提供指导阶段的关联保持灰色；学历、职位或图中位置不会改变来源列定义的指导阶段。

图谱中的 PhD / Postdoc 数量统计当前显示的相应指导连线。这些阶段来自用户和工作簿的定义，不代表网站已逐条外部核实其真实性。

`mentorships.json` 中的公开引用仅作补充资料，须对应准确的原有边和人物编号，并保留公开来源 URL 及查阅日期。引用不会覆盖 N / O 列定义的指导阶段，也不是连线着色的前提。共同指导关系可能只包含原表已记录的一位导师，并不表示完整导师名单。上传文件中的“已核实”标记不会自动获得外部核验认证。

## 人物履历

人物卡片和档案显示机构、机构类型及职业身份。来源明确写作 PhD Student 和 PhD Candidate 时分别展示，不把普通博士生自动升为候选人，也不因某人有博士学历就认定仍在读。

在读博士生和候选人优先使用明确提供的预计毕业日期。若只有博士记录的起止年份，则将结束年份标为来自该记录的预计时间，并保留来源说明。日期缺失时显示未提供；已过期的预计日期提示需要更新，不自动改成已毕业。原始博士教育记录仍可查看。

Faculty 显示所在机构及 Faculty，明确的教授职级可作为职位保留。进入公司的人员显示公司及来源实际提供的职位；职位缺失时显示未提供。招聘目标岗位、内部评估及跟进字段不会充当真实职位。

## 上传与更新数据

支持以下结构化文件，单次上传最大 20 MB：

- `.xlsx`：须包含名为 `Mapping` 或 `Mapping Sheet` 的工作表。
- UTF-8 `.csv` 或 `.tsv`：首部包含有名称的字段行。
- `.json`：人物行数组、包含 `rows` 的对象，或网站图谱导出。

暂不支持 PDF、Word、旧版 `.xls` 或任意简历的自动抽取。Excel 公式只读取文件中已保存的值，不执行公式。

原有字段可继续使用 Legal Name、中文名、PhD、CurrentAffiliation、AffiliationType、Research Line、Industry Line 等表头。新增的公开职业字段为：

| 字段 | 用途 |
| --- | --- |
| `Affiliation Type` / `affiliationType` | University、Research institute、Company 等机构类型 |
| `Academic Status` / `academicStatus` | 明确的 PhD Student、PhD Candidate、Faculty、Postdoc 或 Industry 身份 |
| `Job Title` / `jobTitle` | 真实任职职位 |
| `Expected Graduation` / `expectedGraduation` | 四位年份、ISO 日期或明确提供的毕业学期 |

原表的连写表头 `AffiliationType` 保留其旧含义，用于原有身份或角色字段；带空格的 `Affiliation Type` 用于新的机构类型。

新上传的 Excel、CSV / TSV 和 JSON 均使用同一关系规则：`Research Line` / N 为 PhD 导师，`Industry Line` / O 为 Postdoc 导师，引用人物 → 该行人物。JSON 图谱中的关系也沿用其对应的来源列或指导阶段。预览、浏览器本地版本和发布后的共享版本保持这一解释，不等待外部引用补齐后才着色。

上传文件先在浏览器中解析，按公开字段白名单过滤，再预览新增、更新、关联变化与可能的身份歧义。合并会保留原有人物和关联，只用非空的公开字段更新已匹配档案。文件名或行号不能单独确定人物身份，不能充分确认的记录会分开保留。

确认后可将处理后的数据保存到当前浏览器的 IndexedDB。这个本地版本刷新后仍可使用，但不会改变其他访客看到的共享网站；原始工作簿、排除的私有字段和 GitHub 凭据不会写入本地数据库。需要恢复共享版本时，可清除本地导入。

### 发布到共享数据库

只有 GitHub 账号 `sputnik-odyssey` 可以在网站中发布共享更新。发布时使用仅授权本仓库的 fine-grained personal access token，所需仓库权限为 **Contents: Read and write**。令牌仅在当前操作的内存中使用，不保存到 IndexedDB、localStorage、仓库或 URL；不要把令牌写入上传文件。

发布前会重新读取 GitHub 上的最新共享数据库，并据此重新生成合并和变更预览。若共享数据已有变化，需要复核新的预览后再确认发布，避免旧的本地版本覆盖他人的更新。确认后仅提交处理过的公开数据到 `main` 分支的 `data.json.gz`，原始上传文件不会提交。GitHub Pages 随后自动构建，完成后所有访客都能读取更新。

## 公开数据范围

`data.json.gz` 是 gzip 压缩的 JSON 数据，保留人物姓名、专业教育与机构信息、学术主页和公开身份链接、论文记录，以及关系原文与来源行号。网站在浏览器中解压，需要支持 `DecompressionStream` 的现代浏览器；发布压缩更新还需支持 `CompressionStream`。服务器若已自动解压，网站也可直接读取返回的 JSON。

公开版本不包含联系状态、招聘评估、跟进进展、内部备注或原始工作簿。只在关系字段出现的对象以虚线边框标记；无法充分确认的同名人物分别保留档案。机构名称沿用来源写法，不同别名可能分别统计。履历和关系尚未逐条外部核实；PhD / Postdoc 连线按用户定义的来源列解释，部分关系另附公开引用。

## GitHub Pages 和本地预览

发布文件均位于仓库根目录，无需安装依赖或后端。在 **Settings → Pages** 中选择 **Deploy from a branch**，分支为 **main**，目录为 **/ (root)**。

本地运行 `python3 -m http.server 8765 --bind 127.0.0.1`，然后打开 `http://127.0.0.1:8765/`。

## 贡献与更正

欢迎通过 Issue 或 Pull Request 更正姓名、机构、学位、实际职位或关系。请提供可公开访问的机构主页、学位论文或论文等证据，并尽量注明档案编号和来源行号。请勿提交私人联系方式、招聘记录或未经证实的个人评价。

`app.js` 负责页面交互，`people.mjs` 整理人物显示信息，`importer.mjs` 解析并合并公开数据，`data-sync.mjs` 处理浏览器存储和经所有者认证的发布。`mentorship.mjs` 应用来源列的指导阶段规则并关联补充引用，`graph-render.mjs` 生成带关系类型颜色、实线或虚线、阶段标签和箭头的 SVG。
