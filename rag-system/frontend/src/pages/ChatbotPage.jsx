import React, {useState, useEffect, useRef} from "react";
import {v4 as uuidv4} from 'uuid';
import {askQuestion} from "../api/askService.js";
import {getMessages} from "../api/conversationService.js";
import RoleSelect from "../components/RoleSelect";
import ModelSelect from "../components/ModelSelect";
import ChatInput from "../components/ChatInput";
import Message from "../components/Message";
import MapView from "../components/MapView";
import ConversationHistory from "../components/ConversationHistory";
import "../styles.css";

export default function ChatPage() {
    const [currentConversationId, setCurrentConversationId] = useState(null);
    const [role, setRole] = useState("traveler");
    const [model, setModel] = useState("perplexity");
    const [deepResearch, setDeepResearch] = useState(false);
    const [messages, setMessages] = useState([]);
    const [coords, setCoords] = useState([]);
    const [loading, setLoading] = useState(false);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [showMap, setShowMap] = useState(true);
    const [showHistory, setShowHistory] = useState(false);

    const messagesEndRef = useRef(null);
    const historyRef = useRef(null);
    const chatWindowRef = useRef(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({behavior: "smooth"});
    }, [messages]);

    const parseAllCoordinates = (text) => {
        if (!text) return [];
        const cleanText = text.replace(/<language>[a-z]{2}<\/language>\s*\n?/gi, "");
        const arrayPattern = /\[\s*\{[^[\]]*"latitude"[^[\]]*"longitude"[^[\]]*\}[^[\]]*\]/g;
        const arrayMatches = cleanText.match(arrayPattern);
        let coordinatesArray = [];
        if (arrayMatches) {
            arrayMatches.forEach((match) => {
                try {
                    const parsed = JSON.parse(match);
                    if (Array.isArray(parsed)) {
                        parsed.forEach((coord) => {
                            const lat = coord.latitude || coord.lat;
                            const lon = coord.longitude || coord.lon;
                            if (lat !== undefined && lon !== undefined) {
                                coordinatesArray.push({
                                    latitude: parseFloat(lat),
                                    longitude: parseFloat(lon),
                                    name: coord.name || `Địa điểm ${coordinatesArray.length + 1}`
                                });
                            }
                        });
                    }
                } catch (e) {
                    console.warn("Failed to parse coordinate array", e);
                }
            });
        }
        if (coordinatesArray.length === 0) {
            const coordPattern = /\{[^{}]*"latitude"[^{}]*"longitude"[^{}]*\}|\{[^{}]*"longitude"[^{}]*"latitude"[^{}]*\}/g;
            const matches = cleanText.match(coordPattern);
            if (matches) {
                matches.forEach((match) => {
                    try {
                        const parsed = JSON.parse(match);
                        const lat = parsed.latitude || parsed.lat;
                        const lon = parsed.longitude || parsed.lon;
                        if (lat !== undefined && lon !== undefined) {
                            coordinatesArray.push({
                                latitude: parseFloat(lat),
                                longitude: parseFloat(lon),
                                name: parsed.name || `Địa điểm ${coordinatesArray.length + 1}`
                            });
                        }
                    } catch (e) {
                        console.warn("Failed to parse coordinate", e);
                    }
                });
            }
        }
        return coordinatesArray;
    };

    const removeCoordinatesText = (text) => {
        const patterns = [
            { marker: '## Coordinates', type: 'markdown-header' },
            { marker: '**Coordinates:**', type: 'bold-text' },
            { marker: '**Coordinates Example (for locations):**', type: 'bold-text-example' }
        ];

        let result = text;

        for (const pattern of patterns) {
            const startIndex = result.indexOf(pattern.marker);
            if (startIndex === -1) continue;

            let endIndex = -1;

            // Tìm ```json block
            const jsonBlockStart = result.indexOf('```json', startIndex);
            if (jsonBlockStart !== -1 && jsonBlockStart - startIndex < 200) {
                const jsonBlockEnd = result.indexOf('```', jsonBlockStart + 7);
                if (jsonBlockEnd !== -1) {
                    endIndex = jsonBlockEnd + 3;
                }
            }

            // Tìm array trực tiếp
            if (endIndex === -1) {
                let searchStart = startIndex + pattern.marker.length;
                const arrayStart = result.indexOf('[', searchStart);

                if (arrayStart !== -1) {
                    const betweenText = result.substring(searchStart, arrayStart);
                    if (/^\s*$/.test(betweenText)) {
                        let bracketCount = 0;
                        let foundCoordinates = false;

                        for (let i = arrayStart; i < result.length; i++) {
                            const char = result[i];
                            if (char === '[') bracketCount++;
                            if (char === ']') bracketCount--;

                            const chunk = result.substring(arrayStart, i + 1);
                            if ((chunk.includes('longitude') && chunk.includes('latitude')) ||
                                (chunk.includes('"name"') && chunk.includes('"latitude"'))) {
                                foundCoordinates = true;
                            }

                            if (bracketCount === 0 && foundCoordinates) {
                                endIndex = i + 1;
                                break;
                            }
                        }
                    }
                }
            }

            if (endIndex !== -1) {
                // Xóa từ marker đến hết coordinates
                result = result.substring(0, startIndex) + result.substring(endIndex);

                // Dọn dẹp
                result = result.replace(/\n{3,}/g, '\n\n').trim();
            }
        }

        return result;
    };

    const handleSelectConversation = async (convId) => {
        if (loading || convId === currentConversationId) return;
        setLoadingHistory(true);
        setCurrentConversationId(convId);
        setShowHistory(false);
        try {
            const response = await getMessages(convId, 100);
            const displayMessages = (response.messages || []).map(msg => ({
                role: msg.role,
                content: removeCoordinatesText(msg.content),
                model: model
            }));
            setMessages(displayMessages);
            const lastAssistant = [...response.messages].reverse().find(m => m.role === "assistant");
            if (lastAssistant) {
                const allCoords = parseAllCoordinates(lastAssistant.content);
                setCoords(allCoords.length > 0 ? allCoords : []);
                setShowMap(allCoords.length > 0);
            } else {
                setCoords([]);
            }
        } catch (error) {
            console.error("Failed to load conversation:", error);
        } finally {
            setLoadingHistory(false);
        }
    };

    const handleNewConversation = () => {
        setCurrentConversationId(null);
        setMessages([]);
        setCoords([]);
        setShowHistory(false);
    };

    const handleAsk = async (question) => {
        if (!question.trim() || loading) return;
        let convId = currentConversationId || uuidv4();
        if (!currentConversationId) setCurrentConversationId(convId);

        const userMessage = {role: "user", content: question, model: model};
        setMessages((prev) => [...prev, userMessage]);
        setLoading(true);

        try {
            const res = await askQuestion(convId, role, question, model, deepResearch);
            const assistantMessage = {
                role: "assistant",
                content: removeCoordinatesText(res.answer) || "Lỗi: Không nhận được phản hồi.",
                model: model, mode: res.mode, language: res.language,
            };
            setMessages((prev) => [...prev, assistantMessage]);
            const allCoords = parseAllCoordinates(res.answer);
            setCoords(allCoords.length > 0 ? allCoords : []);
            setShowMap(allCoords.length > 0);
            historyRef.current?.refresh();
        } catch (error) {
            console.error("API Error:", error);
            const errorMsg = error.response?.data?.detail || error.message || "Lỗi không xác định";
            setMessages((prev) => [...prev, {role: "assistant", content: `❌ Lỗi: ${errorMsg}`, model: model}]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="chat-page">
            <div className="header">
                <h1>📜 Trợ lý Du lịch & Lịch sử</h1>
                <div className="header-actions">
                    <button className="btn-clear-chat" onClick={handleNewConversation} title="Cuộc trò chuyện mới">➕
                        Mới
                    </button>
                    <button className="btn-show-history" onClick={() => setShowHistory(true)}
                            title="Lịch sử trò chuyện">📜 Lịch sử
                    </button>
                </div>
            </div>
            <div className="chat-container">
                {/* CẤU TRÚC CỦA CONFIG PANEL*/}
                <div className="config-panel">
                    <div className="user-config">
                        <RoleSelect role={role} setRole={setRole}/>
                    </div>
                    <ModelSelect model={model} setModel={setModel} deepResearch={deepResearch}
                                 setDeepResearch={setDeepResearch}/>
                    {currentConversationId && (
                        <div className="conversation-id-display">
                            <small>💬 ID: {currentConversationId}</small>
                        </div>
                    )}
                </div>

                <div className="chat-window" ref={chatWindowRef}>
                    {loadingHistory && <div className="empty-chat">
                        <div className="empty-icon">⏳</div>
                        <p>Đang tải lịch sử...</p></div>}
                    {!loadingHistory && messages.length === 0 && <div className="empty-chat">
                        <div className="empty-icon">💬</div>
                        <p>Bắt đầu cuộc trò chuyện!</p><small>Hỏi bất cứ điều gì về lịch sử hoặc du lịch</small></div>}
                    {!loadingHistory && messages.map((m, i) => <Message key={i} role={m.role} content={m.content}
                                                                        model={m.model} mode={m.mode}
                                                                        language={m.language}/>)}
                    {coords && coords.length > 0 && showMap &&
                        <div key="map-view" className="map-view-container"><MapView coords={coords}
                                                                                    onClose={() => setShowMap(false)}/>
                        </div>}
                    <div ref={messagesEndRef}/>
                </div>
                <ChatInput onSubmit={handleAsk} loading={loading}/>
                {loading &&
                    <div className="status-bar">⏳ {deepResearch ? "Deep Research đang chạy..." : "Đang xử lý..."}</div>}
            </div>
            {showHistory && (
                <ConversationHistory
                    ref={historyRef}
                    currentConversationId={currentConversationId}
                    onSelectConversation={handleSelectConversation}
                    onNewConversation={handleNewConversation}
                    onClose={() => setShowHistory(false)}
                />
            )}
        </div>
    );
}
