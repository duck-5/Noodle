package com.example.tautracker.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "assignments")
data class AssignmentEntity(
    @PrimaryKey val id: Long,
    val cmid: Long,
    val name: String,
    val dueDate: Long,
    val courseId: Long,
    val isDone: Boolean = false,
    val notes: String? = null
)
