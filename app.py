"""app.py - SEED 未来の森 (multi-user)"""

from datetime import datetime, timedelta
import streamlit as st
from dotenv import load_dotenv

import db
from ai import interpret_seed, TREE_TYPES
from forest import render_forest, assign_position_for_new_seed
from auth import render_login_screen, render_logout_button, get_current_user

load_dotenv()
db.init_db()

st.set_page_config(
    page_title="SEED - 未来の森",
    page_icon="🌳",
    layout="wide",
    initial_sidebar_state="expanded",
)

# 1日あたりのたね蒔き上限(レートリミット)
DAILY_LIMIT = 10

CSS = """
<style>
/* Streamlit Cloud のプラットフォーム要素を非表示 */
[data-testid="stToolbar"],
[data-testid="stDecoration"],
[data-testid="stStatusWidget"],
.stDeployButton,
[data-testid="manage-app-button"],
[data-testid="resizableComponent"],
button[kind="manageAppButton"],
[class*="viewerBadge"],
[class*="ManageApp"],
[class*="manage-app"],
[class*="terminalResizable"],
[class*="streamlitStatus"] {
  display: none !important;
}

/* ヘッダーは透明にする(サイドバー開閉ボタンは残したいので非表示にしない) */
header[data-testid="stHeader"] {
  background: transparent !important;
  height: auto !important;
}


/* 上部余白を詰める */
.main .block-container { padding-top: 1rem !important; }

@import url('https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;500;700;800&display=swap');
html, body, .stMarkdown, .stTextInput, .stTextArea, .stRadio,
.stButton, .stCaption, h1, h2, h3, h4, h5, h6, p, button, input, textarea {
  font-family: 'M PLUS Rounded 1c', 'Hiragino Sans', 'Yu Gothic', sans-serif !important;
}
/* Material Icons はそのまま(アイコンフォントなので上書きしない) */
.material-icons, .material-icons-outlined, [class*="MaterialIcon"],
span[class*="icon"], i.material-icons, i[class*="material-icons"] {
  font-family: 'Material Icons', 'Material Symbols Outlined', sans-serif !important;
}
.keeper-msg {
  background: linear-gradient(135deg, rgba(58,80,40,0.18), rgba(120,140,90,0.10));
  border-left: 3px solid #7a9560;
  padding: 14px 18px; margin: 14px 0 6px 0;
  border-radius: 8px; font-family: 'M PLUS Rounded 1c', sans-serif;
  font-size: 1.05rem; line-height: 1.7; color: #d8e2c8;
}
.relation-msg {
  background: linear-gradient(135deg, rgba(80,60,30,0.18), rgba(140,110,60,0.10));
  border-left: 3px solid #b18a4a;
  padding: 12px 16px; margin: 10px 0;
  border-radius: 8px; font-family: 'M PLUS Rounded 1c', sans-serif;
  font-size: 0.95rem; line-height: 1.65; color: #e6d8b8;
}
.knowledge-box {
  background: rgba(40,50,30,0.30);
  padding: 16px 22px; margin: 12px 0;
  border-radius: 10px;
  border: 1px solid rgba(140,160,90,0.18);
}
.next-seeds-title {
  color: #b9bba8; font-size: 0.9rem;
  margin-top: 18px; margin-bottom: 6px;
}
.quiet-caption { color: #b9bba8; font-size: 0.85rem; margin-top: -8px; }
.forest-path {
  background: linear-gradient(135deg, rgba(70,55,30,0.20), rgba(110,80,40,0.12));
  border-radius: 10px; padding: 14px 18px 8px 18px;
  margin: 14px 0 10px 0;
  border: 1px dashed rgba(180,150,90,0.35);
}
.forest-path-title {
  color: #d8c896; font-size: 0.95rem;
  margin-bottom: 8px; font-family: 'M PLUS Rounded 1c', sans-serif;
}
.forest-path-item {
  color: #ede5cc; line-height: 1.7; margin: 4px 0;
  font-size: 0.96rem;
}
.small-tag {
  display: inline-block; padding: 1px 8px; margin-right: 4px;
  font-size: 0.78rem; border-radius: 10px;
  background: rgba(140,160,90,0.18); color: #d8e2c8;
}
.timeline-group {
  color: #a9b598; font-size: 0.95rem;
  margin: 22px 0 10px 0; font-family: 'M PLUS Rounded 1c', sans-serif;
  border-bottom: 1px solid rgba(140,160,90,0.18);
  padding-bottom: 4px;
}
.tree-detail-banner {
  background: linear-gradient(135deg, rgba(40,60,40,0.45), rgba(80,100,60,0.20));
  border: 1px solid rgba(160,180,120,0.30);
  padding: 18px 22px; border-radius: 12px;
  margin: 14px 0;
}
.author-badge {
  display: inline-block; padding: 1px 8px; margin-right: 6px;
  font-size: 0.78rem; border-radius: 10px;
  background: rgba(140,90,160,0.18); color: #d8c5e2;
}
</style>
"""
st.markdown(CSS, unsafe_allow_html=True)


# ===== ログイン =====
user = render_login_screen()
USER_ID = user["id"]
USER_NAME = user["name"]

# サイドバー: ログアウトボタン
render_logout_button()

# ===== ヘルパー =====
def row_get(row, key, default=None):
    try:
        if key in row.keys():
            v = row[key]
            return v if v is not None else default
    except Exception:
        pass
    return default


def tree_label_with_emoji(tree_type):
    info = TREE_TYPES.get(tree_type)
    if info is None:
        return "🌳 木"
    emoji, jp, _desc = info
    return emoji + " " + jp


# ===== ヘッダー =====
st.markdown("# 🌳 未来の森")
st.markdown(
    '<div class="quiet-caption">'
    f'こんにちは、{USER_NAME}さん。つぶやきが一本の木になります。'
    '</div>',
    unsafe_allow_html=True,
)

# ===== サイドバー: 表示モード切替 =====
view_mode = st.sidebar.radio(
    "🌲 見る森",
    ["🌒 静寂の森", "🌞 ひらけた森"],
    index=0,
)

# どのデータを引いてくるか決定
if view_mode == "🌒 静寂の森":
    # 自分の静寂のたねだけ(自分だけ見える)
    seeds_rows = db.list_seeds(limit=300, user_id=USER_ID, category="personal")
else:  # 🌞 ひらけた森(社内全員のひらけた森が混ざる)
    seeds_rows = db.list_seeds(limit=300, category="business")

# ===== 森の描画 =====
seeds_for_render = [
    {
        "id": r["id"],
        "tree_type": row_get(r, "tree_type", "pine"),
        "size": row_get(r, "size", 1),
        "x_position": row_get(r, "x_position", 0.5),
        "linked_seed_id": row_get(r, "linked_seed_id", None),
        "tweet_excerpt": (r["tweet"] or "")[:40],
    }
    for r in seeds_rows
]

forest_svg = render_forest(seeds_for_render)
st.markdown(forest_svg, unsafe_allow_html=True)

# ===== 木をタップで詳細表示(スマホ向け大きめボタン)=====
if seeds_for_render:
    with st.expander(f"🌲 木の一覧({len(seeds_for_render)}本)", expanded=False):
        # 新しい順に最大30本までボタン表示(古いものはタイムラインで)
        recent_for_buttons = seeds_for_render[:30]
        # 1行2列で並べる(スマホでも押しやすいサイズ)
        for i in range(0, len(recent_for_buttons), 2):
            cols = st.columns(2)
            for j, col in enumerate(cols):
                idx = i + j
                if idx >= len(recent_for_buttons):
                    break
                t = recent_for_buttons[idx]
                tree_label = tree_label_with_emoji(t["tree_type"])
                excerpt = t["tweet_excerpt"] or "(空のたね)"
                btn_label = f"{tree_label}  {excerpt}"
                with col:
                    if st.button(btn_label, key=f"tree_btn_{t['id']}", use_container_width=True):
                        st.query_params["seed"] = str(t["id"])
                        st.rerun()

# session_state
if "last_seed_result" not in st.session_state:
    st.session_state.last_seed_result = None
if "prefill_tweet" not in st.session_state:
    st.session_state.prefill_tweet = ""
if "selected_category" not in st.session_state:
    st.session_state.selected_category = "personal"

# ===== クリックされた木の詳細表示 =====
query_params = st.query_params
clicked_seed_id = None
if "seed" in query_params:
    try:
        clicked_seed_id = int(query_params["seed"])
    except (TypeError, ValueError):
        clicked_seed_id = None

if clicked_seed_id is not None:
    seed_row = db.get_seed(clicked_seed_id)
    if seed_row:
        # アクセス権チェック: 自分のたね、またはひらけた森のたね
        seed_user_id = row_get(seed_row, "user_id", "legacy")
        seed_category = row_get(seed_row, "category", "personal")
        can_view = (seed_user_id == USER_ID) or (seed_category == "business")

        if can_view:
            tree_type = row_get(seed_row, "tree_type", "pine")
            size = row_get(seed_row, "size", 1)
            tree_label = tree_label_with_emoji(tree_type)
            size_label = {1: "芽", 2: "若木", 3: "大木"}.get(size, "")
            author_name = row_get(seed_row, "user_name", "")
            category_label = "🌞 ひらけた森" if seed_category == "business" else "🌒 静寂の森"

            st.markdown('<div class="tree-detail-banner">', unsafe_allow_html=True)
            header_parts = [tree_label + "の" + size_label, category_label]
            if author_name:
                header_parts.append('<span class="author-badge">' + author_name + '</span>')
            st.markdown("### " + " ".join(header_parts), unsafe_allow_html=True)
            st.caption(seed_row["created_at"])
            st.markdown("> " + seed_row["tweet"])
            if seed_row["tags"]:
                tag_html = "".join(
                    '<span class="small-tag">#' + t + '</span>' for t in seed_row["tags"].split(",")
                )
                st.markdown(tag_html, unsafe_allow_html=True)
            keeper_msg = row_get(seed_row, "keeper_message", "")
            if keeper_msg:
                st.markdown(
                    '<div class="keeper-msg">🍃 ' + keeper_msg + '</div>',
                    unsafe_allow_html=True,
                )
            if seed_row["ai_response"]:
                st.markdown('<div class="knowledge-box">', unsafe_allow_html=True)
                st.markdown(seed_row["ai_response"])
                st.markdown('</div>', unsafe_allow_html=True)
            st.markdown('</div>', unsafe_allow_html=True)

            col_a, col_b = st.columns([1, 1])
            with col_a:
                if st.button("🔙 森に戻る", key="close_detail"):
                    st.query_params.clear()
                    st.rerun()
            with col_b:
                # 削除ボタンは自分のたねだけ
                if seed_user_id == USER_ID:
                    if st.button("🍂 このたねを忘れる", key="del_from_detail"):
                        db.delete_seed(clicked_seed_id, user_id=USER_ID)
                        st.query_params.clear()
                        st.rerun()
            st.divider()
        else:
            st.warning("このたねは閲覧できません。")
            if st.button("🔙 森に戻る", key="close_blocked"):
                st.query_params.clear()
                st.rerun()
            st.divider()

# ===== たねを蒔く =====
st.markdown("### 🌱 今日のたね")

# 今日の蒔き回数チェック
today_count = db.count_seeds_today(USER_ID)
remaining = max(0, DAILY_LIMIT - today_count)
st.caption(f"今日のたね: {today_count} / {DAILY_LIMIT} 本")

# カテゴリ選択
category_choice = st.radio(
    "どこに蒔く?",
    ["🌒 静寂の森(自分だけ)", "🌞 ひらけた森(みんな見れる)"],
    horizontal=True,
    index=0 if st.session_state.selected_category == "personal" else 1,
    key="category_radio",
)
selected_category = "business" if "ひらけた" in category_choice else "personal"
st.session_state.selected_category = selected_category

with st.form(key="tweet_form", clear_on_submit=True):
    tweet = st.text_area(
        "言葉になっていないことでも、書き留めておけます。",
        value=st.session_state.prefill_tweet,
        placeholder="例: 通勤中に見た雲がやけに低かった気がする",
        height=110,
    )
    submitted = st.form_submit_button("🌱 蒔く", type="primary", disabled=(remaining <= 0))

if remaining <= 0:
    st.warning(f"今日の蒔き上限({DAILY_LIMIT}本)に達しました。明日また会いましょう。")

if submitted:
    st.session_state.prefill_tweet = ""
    if not tweet.strip():
        st.warning("つぶやきを入力してください。")
    elif remaining <= 0:
        st.warning(f"今日の蒔き上限({DAILY_LIMIT}本)に達しました。")
    else:
        with st.spinner("番人が森を歩いています..."):
            try:
                # 自分の過去のたねだけを文脈に
                recent = db.list_recent_summaries(limit=30, user_id=USER_ID)
                result = interpret_seed(tweet.strip(), recent_seeds=recent)
                x_pos = assign_position_for_new_seed(seeds_for_render, tweet.strip())

                seed_id = db.add_seed(
                    tweet=tweet.strip(),
                    ai_response=result["knowledge"],
                    tags=result["tags"],
                    tree_type=result["tree_type"],
                    size=result["size"],
                    x_position=x_pos,
                    keeper_message=result["keeper_message"],
                    linked_seed_id=result.get("related_seed_id"),
                    user_id=USER_ID,
                    user_name=USER_NAME,
                    category=selected_category,
                )
                st.session_state.last_seed_result = {
                    "seed_id": seed_id,
                    "tweet": tweet.strip(),
                    "category": selected_category,
                    **result,
                }
                st.query_params.clear()
                st.rerun()
            except Exception as e:
                st.error("番人が首をかしげています: " + str(e))

# ===== 直近の蒔いた結果を物語として展開表示 =====
last = st.session_state.last_seed_result
if last:
    st.markdown("---")
    cat_label = "🌞 ひらけた森" if last.get("category") == "business" else "🌒 静寂の森"
    st.markdown(f"### ✨ 今のたね　{cat_label}")
    st.markdown("> " + last["tweet"])

    if last.get("tags"):
        tag_html = "".join(
            '<span class="small-tag">#' + t + '</span>' for t in last["tags"].split(",")
        )
        st.markdown(tag_html, unsafe_allow_html=True)

    if last.get("keeper_message"):
        st.markdown(
            '<div class="keeper-msg">🍃 森の番人<br/>' + last["keeper_message"] + '</div>',
            unsafe_allow_html=True,
        )

    if last.get("relation_story"):
        st.markdown(
            '<div class="relation-msg">🌿 木と木のつながり<br/>' + last["relation_story"] + '</div>',
            unsafe_allow_html=True,
        )

    if last.get("knowledge"):
        st.markdown('<div class="knowledge-box">', unsafe_allow_html=True)
        st.markdown(last["knowledge"])
        st.markdown('</div>', unsafe_allow_html=True)

    forest_path = last.get("forest_path", [])
    if forest_path:
        path_html = '<div class="forest-path"><div class="forest-path-title">🚶 森の小道(今日〜今週やってみる)</div>'
        for step in forest_path:
            path_html += '<div class="forest-path-item">・ ' + step + '</div>'
        path_html += '</div>'
        st.markdown(path_html, unsafe_allow_html=True)

    next_seeds = last.get("next_seeds", [])
    if next_seeds:
        st.markdown(
            '<div class="next-seeds-title">🌱 ここから派生して育てられるたね</div>',
            unsafe_allow_html=True,
        )
        cols = st.columns(len(next_seeds))
        for i, ns in enumerate(next_seeds):
            with cols[i]:
                if st.button("🌱 " + ns, key="ns_" + str(i), use_container_width=True):
                    st.session_state.prefill_tweet = ns
                    st.session_state.last_seed_result = None
                    st.rerun()

    st.markdown("")
    if st.button("このたねを森に置いて、次に進む", key="dismiss_last"):
        st.session_state.last_seed_result = None
        st.rerun()


# ===== 過去のたね一覧(タイムライン) =====
def time_group(created_at_str):
    try:
        created = datetime.fromisoformat(created_at_str)
    except Exception:
        return "older"
    now = datetime.now()
    today = now.date()
    cdate = created.date()
    if cdate == today:
        return "today"
    if cdate == today - timedelta(days=1):
        return "yesterday"
    if (today - cdate).days < 7:
        return "this_week"
    if cdate.year == today.year and cdate.month == today.month:
        return "this_month"
    return "older"


GROUP_LABELS = {
    "today": "🌅 今日",
    "yesterday": "🌙 昨日",
    "this_week": "📅 今週",
    "this_month": "🗓️ 今月",
    "older": "🍂 それ以前",
}
GROUP_ORDER = ["today", "yesterday", "this_week", "this_month", "older"]

st.divider()
total_label = {"🌒 静寂の森": "静寂の森のたね",
               "🌞 ひらけた森": "ひらけた森のたね"}.get(view_mode, "たね")

with st.expander(f"🍂 {total_label}({len(seeds_rows)}本)", expanded=False):
    keyword = st.text_input("キーワード検索", "")
    if keyword.strip():
        filtered_rows = [r for r in seeds_rows
                         if keyword.lower() in (r["tweet"] or "").lower()
                         or keyword.lower() in (r["ai_response"] or "").lower()
                         or keyword.lower() in (r["tags"] or "").lower()]
    else:
        filtered_rows = seeds_rows

    if not filtered_rows:
        st.info("該当するたねがありません。")
    else:
        grouped = {k: [] for k in GROUP_ORDER}
        for r in filtered_rows:
            g = time_group(r["created_at"])
            grouped[g].append(r)

        size_label = {1: "芽", 2: "若木", 3: "大木"}
        for g in GROUP_ORDER:
            group_rows = grouped[g]
            if not group_rows:
                continue
            st.markdown(
                '<div class="timeline-group">' + GROUP_LABELS[g]
                + ' (' + str(len(group_rows)) + '本)</div>',
                unsafe_allow_html=True,
            )
            for row in group_rows:
                tree_type = row_get(row, "tree_type", "pine")
                size = row_get(row, "size", 1)
                tree_label = tree_label_with_emoji(tree_type)
                seed_user_id = row_get(row, "user_id", "legacy")
                seed_user_name = row_get(row, "user_name", "")
                seed_category = row_get(row, "category", "personal")
                cat_label = "🌞" if seed_category == "business" else "🌒"

                with st.container(border=True):
                    header = "**" + tree_label + "の" + size_label.get(size, "") + "**"
                    header += "　" + cat_label
                    if seed_user_id != USER_ID and seed_user_name:
                        header += '　<span class="author-badge">' + seed_user_name + '</span>'
                    header += "　·　" + row["created_at"]
                    st.markdown(header, unsafe_allow_html=True)
                    st.markdown("> " + row["tweet"])
                    if row["tags"]:
                        tag_html = "".join(
                            '<span class="small-tag">#' + t + '</span>' for t in row["tags"].split(",")
                        )
                        st.markdown(tag_html, unsafe_allow_html=True)
                    keeper_msg = row_get(row, "keeper_message", "")
                    if keeper_msg:
                        st.markdown(
                            '<div class="keeper-msg">🍃 ' + keeper_msg + '</div>',
                            unsafe_allow_html=True,
                        )
                    show_key = "show_knowledge_" + str(row["id"])
                    if st.toggle("📚 知識展開を読む", key=show_key):
                        st.markdown(row["ai_response"])
                    if seed_user_id == USER_ID:
                        if st.button("🍂 このたねを忘れる", key="del_" + str(row["id"])):
                            db.delete_seed(row["id"], user_id=USER_ID)
                            st.rerun()
